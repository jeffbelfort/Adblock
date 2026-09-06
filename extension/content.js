// content.js
// Cosmetic filtering is primarily declarative CSS.
// JavaScript is retained only for procedural/site-specific behaviour.

const host = location.hostname.toLowerCase();
const cleanHost = host.replace(/^www\./, '');

const DEFAULT_SETTINGS = {
  requests: true,
  cosmetic: true,
  youtube: true,
  itvx: true,
  soundcloud: true,
  autosync: true,
};

let settings = { ...DEFAULT_SETTINGS };
let whitelist = [];
let isWhitelisted = false;

let dynamicCosmeticRules = [];
let applicableDynamicRules = [];
let applicableCosmeticExceptionSelectors = new Set();

let mutationTimer = null;
const MUTATION_DEBOUNCE_MS = 75;

const BUILTIN_STYLE_ID = 'adblock-builtin-cosmetics';
const DYNAMIC_STYLE_ID = 'adblock-dynamic-cosmetics';

// ─────────────────────────────────────────────────────────────────────────────
// Settings / whitelist
// ─────────────────────────────────────────────────────────────────────────────

function domainMatches(entry) {
  const domain = String(entry || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/^www\./, '');

  if (!domain) return false;

  return (
    cleanHost === domain ||
    cleanHost.endsWith('.' + domain)
  );
}

function refreshProtectionState(items) {
  if (items.settings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...items.settings,
    };
  }

  if (Array.isArray(items.whitelist)) {
    whitelist = items.whitelist;
  }

  isWhitelisted = whitelist.some(domainMatches);

  updateCosmeticStyles();
  publishStreamingState();
  publishYouTubeState();
}

function publishYouTubeState() {
  const enabled =
    !isWhitelisted &&
    settings.youtube !== false;

  const apply = () => {
    if (!document.documentElement) {
      return false;
    }

    document.documentElement.dataset.adblockYoutubeEnabled =
      enabled ? '1' : '0';

    document.dispatchEvent(
      new CustomEvent('adblock-youtube-config', {
        detail: { enabled },
      })
    );

    return true;
  };

  if (!apply()) {
    const timer = setInterval(() => {
      if (apply()) {
        clearInterval(timer);
      }
    }, 10);

    setTimeout(() => clearInterval(timer), 2000);
  }
}

function publishStreamingState() {
  const enabled =
    !isWhitelisted &&
    settings.itvx !== false;

  const apply = () => {
    if (!document.documentElement) {
      return false;
    }

    document.documentElement.dataset.adblockStreamingEnabled =
      enabled ? '1' : '0';

    document.dispatchEvent(
      new CustomEvent('adblock-streaming-config', {
        detail: { enabled },
      })
    );

    return true;
  };

  if (!apply()) {
    const timer = setInterval(() => {
      if (apply()) {
        clearInterval(timer);
      }
    }, 10);

    setTimeout(() => clearInterval(timer), 2000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in cosmetic rules
// ─────────────────────────────────────────────────────────────────────────────

const cosmeticRules = {
  '*': [
    '[id*="google_ads"]',
    '[id*="div-gpt-ad"]',
    '[class*="google-ad"]',
    '[class*="dfp-ad"]',
    '[class*="ad-banner"]',
    '[class*="ad-slot"]',
    '[class*="ad-unit"]',
    '[class*="ad-container"]',
    '[class*="advert"]',
    '[class*="advertisement"]',
    '[data-ad-unit]',
    '[data-ad-slot]',
    'ins.adsbygoogle',
    '.adsbygoogle',
  ],

  'youtube.com': [
    '.ytp-ad-overlay-container',
    '.ytp-ad-text-overlay',

    '#masthead-ad',
    '#player-ads',

    'ytd-ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-video-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-search-pyv-renderer',

    '.ytd-display-ad-renderer',
    '.ytd-ad-slot-renderer',

    '#panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',

    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-display-ad-renderer)',
    'ytd-rich-item-renderer:has(ytd-promoted-video-renderer)',
    'ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer)',
    'ytd-rich-item-renderer:has(ytd-promoted-sparkles-text-search-renderer)',
    'ytd-rich-item-renderer:has(ytd-search-pyv-renderer)',
  ],

  'itvx.co.uk': [
    '.advert',
    '.ad-break',
    '[class*="advert"]',
    '[class*="sponsor"]',
    '.ima-ad-container',
  ],

  'channel4.com': [
    '.ad-container',
    '.advert-container',
    '[class*="advert"]',
    '.pre-roll',
  ],

  'dailymail.co.uk': [
    '.mol-ads',
    '.mol-ads-label',
    '[id*="mol-ad"]',
    '.commercial-unit',
    '.sponsored-content',
    '[class*="sponsored"]',
  ],

  'thesun.co.uk': [
    '.ad-container',
    '[class*="teads"]',
    '[id*="teads"]',
    '.gu-ad',
    '[class*="commercial"]',
  ],

  'mirror.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[data-module="Advertisement"]',
  ],

  'metro.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '.commercial-feature',
  ],

  'independent.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[id*="div-gpt"]',
    '.piano-inline-content',
  ],

  'skynews.com': [
    '.ad-container',
    '[class*="advert"]',
    '[id*="div-gpt"]',
  ],

  'reddit.com': [
    '[data-testid="promoted-post"]',
    'shreddit-ad-post',
    '[class*="promotedlink"]',
    '.promotedlink',
  ],

  'twitch.tv': [
    '.ad-banner-default',
    '[class*="ad-banner"]',
    '.channel-leaderboard-wrapper',
    '.tw-ad',
  ],

  'msn.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.adunit',
  ],

  'yahoo.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.adslot',
    '[data-ylk*="ad"]',
  ],

  'givemesport.com': [
    '[class*="advert"]',
    '[id*="advert"]',
    '.ad-slot',
  ],

  'goal.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.advertisement',
  ],

  'talksport.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[id*="div-gpt"]',
  ],
};

const builtInSelectors = [
  ...(cosmeticRules['*'] || []),
  ...(cosmeticRules[host] || []),
  ...(cosmeticRules[cleanHost] || []),
];

// ─────────────────────────────────────────────────────────────────────────────
// CSS injection
// ─────────────────────────────────────────────────────────────────────────────

function getOrCreateStyle(id) {
  let style = document.getElementById(id);

  if (style) {
    return style;
  }

  style = document.createElement('style');
  style.id = id;
  style.type = 'text/css';

  const parent =
    document.head ||
    document.documentElement;

  if (parent) {
    parent.appendChild(style);
  }

  return style;
}

function selectorIsValid(selector) {
  if (!selector) {
    return false;
  }

  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function selectorsToCSS(selectors) {
  const uniqueSelectors = [
    ...new Set(
      selectors
        .filter(Boolean)
        .filter(selectorIsValid)
    ),
  ];

  if (uniqueSelectors.length === 0) {
    return '';
  }

  return `
${uniqueSelectors.join(',\n')} {
  display: none !important;
  visibility: hidden !important;
}
`;
}

function updateBuiltInCosmeticStyle() {
  const style = getOrCreateStyle(BUILTIN_STYLE_ID);

  if (!style) {
    return;
  }

  if (
    isWhitelisted ||
    settings.cosmetic === false
  ) {
    style.textContent = '';
    return;
  }

  const selectors = builtInSelectors.filter(
    selector =>
      !applicableCosmeticExceptionSelectors.has(selector)
  );

  style.textContent =
    selectorsToCSS(selectors);
}

function updateDynamicCosmeticStyle() {
  const style = getOrCreateStyle(DYNAMIC_STYLE_ID);

  if (!style) {
    return;
  }

  if (
    isWhitelisted ||
    settings.cosmetic === false
  ) {
    style.textContent = '';
    return;
  }

  const selectors =
    applicableDynamicRules.map(
      rule => rule.selector
    );

  style.textContent =
    selectorsToCSS(selectors);
}

function updateCosmeticStyles() {
  updateBuiltInCosmeticStyle();
  updateDynamicCosmeticStyle();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic filter-list cosmetics
// ─────────────────────────────────────────────────────────────────────────────

function ruleAppliesToCurrentHost(rule) {
  if (!rule || !rule.selector) {
    return false;
  }

  if (
    !rule.domains ||
    rule.domains.length === 0
  ) {
    return true;
  }

  return rule.domains.some((d) => {
    const cleanD = String(d || '')
      .toLowerCase()
      .replace(/^www\./, '');

    return (
      cleanD === '*' ||
      cleanHost === cleanD ||
      cleanHost.endsWith('.' + cleanD)
    );
  });
}

function rebuildApplicableDynamicRules() {
  const applicableRules =
    dynamicCosmeticRules.filter(
      rule => ruleAppliesToCurrentHost(rule)
    );

  /*
   * #@# cosmetic exceptions.
   *
   * If an exception applies to this hostname, its selector cancels any
   * matching cosmetic hide rule on this page regardless of which subscribed
   * list supplied the hide rule.
   *
   * Example:
   *
   *   ##.advert
   *   example.com#@#.advert
   *
   * ".advert" remains visible on example.com.
   */
  applicableCosmeticExceptionSelectors =
    new Set(
      applicableRules
        .filter(rule => rule.isException)
        .map(rule => rule.selector)
        .filter(Boolean)
    );

  applicableDynamicRules =
    applicableRules.filter(
      rule =>
        !rule.isException &&
        !applicableCosmeticExceptionSelectors.has(
          rule.selector
        )
    );

  updateCosmeticStyles();
}

async function refreshDynamicCosmeticCache() {
  try {
    const items =
      await chrome.storage.local.get(null);

    const rules = [];

    for (
      const [key, value]
      of Object.entries(items)
    ) {
      if (
        key.startsWith('cosmetic_') &&
        Array.isArray(value)
      ) {
        rules.push(...value);
      }
    }

    dynamicCosmeticRules = rules;

    rebuildApplicableDynamicRules();
  } catch (err) {
    console.error(
      '[adblock] Failed to refresh cosmetic cache:',
      err
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube procedural behaviour
// ─────────────────────────────────────────────────────────────────────────────

let youtubeAdPlaybackState = null;

function skipYouTubeAd() {
  if (
    isWhitelisted ||
    settings.youtube === false
  ) {
    return;
  }

  if (!host.includes('youtube.com')) {
    return;
  }

  const skipButton =
    document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    );

  if (
    skipButton &&
    skipButton.offsetParent !== null &&
    !skipButton.disabled
  ) {
    skipButton.click();

    chrome.runtime.sendMessage({
      type: 'AD_STRIPPED',
      count: 1,
    });

    return;
  }

  const video =
    document.querySelector(
      'video.html5-main-video, video'
    );

  const player =
    document.querySelector(
      '.html5-video-player'
    );

  const adShowing =
    !!(
      player &&
      player.classList.contains('ad-showing')
    );

  if (
    video &&
    adShowing
  ) {
    if (!youtubeAdPlaybackState) {
      youtubeAdPlaybackState = {
        playbackRate: video.playbackRate || 1,
        muted: video.muted,
      };
    }

    // Fast-play an unskippable ad instead of jumping currentTime directly
    // to duration. Directly forcing the media element to "ended" can leave
    // YouTube's internal player state stuck after the ad.
    video.muted = true;

    try {
      if (video.playbackRate < 16) {
        video.playbackRate = 16;
      }
    } catch {
      // Ignore browsers/player states that reject a playback-rate change.
    }

    return;
  }

  if (
    video &&
    !adShowing &&
    youtubeAdPlaybackState
  ) {
    try {
      video.playbackRate =
        youtubeAdPlaybackState.playbackRate;
    } catch {
      // Ignore restore failures.
    }

    video.muted =
      youtubeAdPlaybackState.muted;

    youtubeAdPlaybackState = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITVX procedural behaviour
// ─────────────────────────────────────────────────────────────────────────────

function skipITVXAd() {
  if (
    isWhitelisted ||
    settings.itvx === false
  ) {
    return;
  }

  if (
    !host.includes('itvx.co.uk') &&
    !host.includes('itv.com')
  ) {
    return;
  }

  const videos =
    document.querySelectorAll('video');

  if (videos.length < 4) {
    return;
  }

  videos.forEach((video, index) => {
    if (video.paused) {
      return;
    }

    if (
      !video.duration ||
      video.duration > 120
    ) {
      return;
    }

    const parent =
      video.closest('[class]');

    const parentClass =
      parent
        ? String(parent.className)
        : '';

    const isAdContainer =
      parent &&
      (
        parentClass.includes('videoParent') ||
        parentClass.includes('ad') ||
        index === 3
      );

    if (!isAdContainer) {
      return;
    }

    video.dispatchEvent(
      new Event('ended', {
        bubbles: true,
      })
    );

    chrome.runtime.sendMessage({
      type: 'AD_STRIPPED',
      count: 1,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural pass
// ─────────────────────────────────────────────────────────────────────────────

function runProceduralLogic() {
  if (isWhitelisted) {
    return;
  }

  if (
    settings.youtube !== false &&
    host.includes('youtube.com')
  ) {
    skipYouTubeAd();
  }

  if (
    settings.itvx !== false &&
    (
      host.includes('itvx.co.uk') ||
      host.includes('itv.com')
    )
  ) {
    skipITVXAd();
  }
}

function scheduleProceduralPass() {
  if (mutationTimer !== null) {
    return;
  }

  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    runProceduralLogic();
  }, MUTATION_DEBOUNCE_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────────────────────────────────────

chrome.storage.local.get(
  ['settings', 'whitelist'],
  async (items) => {
    refreshProtectionState(items);

    await refreshDynamicCosmeticCache();

    updateCosmeticStyles();
    runProceduralLogic();
  }
);

chrome.storage.onChanged.addListener(
  (changes, area) => {
    if (area !== 'local') {
      return;
    }

    const update = {};

    if (changes.settings) {
      update.settings =
        changes.settings.newValue || {};
    }

    if (changes.whitelist) {
      update.whitelist =
        changes.whitelist.newValue || [];
    }

    if (
      'settings' in update ||
      'whitelist' in update
    ) {
      refreshProtectionState(update);
      runProceduralLogic();
    }

    const cosmeticsChanged =
      Object.keys(changes).some(
        key => key.startsWith('cosmetic_')
      );

    if (cosmeticsChanged) {
      refreshDynamicCosmeticCache();
    }
  }
);

// Install cosmetic CSS as early as possible.
// Settings loading immediately replaces/clears it if required.
updateBuiltInCosmeticStyle();

// Mutation observation now exists ONLY for procedural functionality.
// Cosmetic filtering itself does not depend on MutationObserver anymore.
if (
  host.includes('youtube.com') ||
  host.includes('itvx.co.uk') ||
  host.includes('itv.com')
) {
  const observer =
    new MutationObserver(
      scheduleProceduralPass
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );
}

document.addEventListener(
  'DOMContentLoaded',
  () => {
    updateCosmeticStyles();
    runProceduralLogic();
  }
);

// Preserve the fast YouTube Skip button check.
if (host.includes('youtube.com')) {
  setInterval(() => {
    if (
      !isWhitelisted &&
      settings.youtube !== false
    ) {
      skipYouTubeAd();
    }
  }, 300);
}

console.log(
  '[adblock] CSS cosmetic engine active on',
  host
);