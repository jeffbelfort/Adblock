// content.js - Runs on every page
// Handles cosmetic filtering (removing ad elements) and YouTube ad skipping

const host = location.hostname;

// ── Cosmetic filter rules ──────────────────────────────────────────────────
const cosmeticRules = {
  // General - works across most sites
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

  // YouTube
  'youtube.com': [
    '.ytp-ad-module',
    '.ytp-ad-overlay-container',
    '.ytp-ad-text-overlay',
    '#masthead-ad',
    '.ytd-display-ad-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-search-pyv-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    '#player-ads',
    '#panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ytd-ad-slot-renderer',
    '.ytd-ad-slot-renderer',
  ],

  // ITVX
  'itvx.co.uk': [
    '.advert',
    '.ad-break',
    '[class*="advert"]',
    '[class*="sponsor"]',
    '.ima-ad-container',
  ],

  // Channel 4
  'channel4.com': [
    '.ad-container',
    '.advert-container',
    '[class*="advert"]',
    '.pre-roll',
  ],

  // Daily Mail
  'dailymail.co.uk': [
    '.mol-ads',
    '.mol-ads-label',
    '[id*="mol-ad"]',
    '.commercial-unit',
    '.sponsored-content',
    '[class*="sponsored"]',
  ],

  // The Sun
  'thesun.co.uk': [
    '.ad-container',
    '[class*="teads"]',
    '[id*="teads"]',
    '.gu-ad',
    '[class*="commercial"]',
  ],

  // Mirror
  'mirror.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[data-module="Advertisement"]',
  ],

  // Metro
  'metro.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '.commercial-feature',
  ],

  // Independent
  'independent.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[id*="div-gpt"]',
    '.piano-inline-content',
  ],

  // Sky News
  'skynews.com': [
    '.ad-container',
    '[class*="advert"]',
    '[id*="div-gpt"]',
  ],

  // Reddit
  'reddit.com': [
    '[data-testid="promoted-post"]',
    'shreddit-ad-post',
    '[class*="promotedlink"]',
    '.promotedlink',
  ],

  // Twitch
  'twitch.tv': [
    '.ad-banner-default',
    '[class*="ad-banner"]',
    '.channel-leaderboard-wrapper',
    '.tw-ad',
  ],

  // MSN
  'msn.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.adunit',
  ],

  // Yahoo
  'yahoo.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.adslot',
    '[data-ylk*="ad"]',
  ],

  // GiveMeSport
  'givemesport.com': [
    '[class*="advert"]',
    '[id*="advert"]',
    '.ad-slot',
  ],

  // Goal.com
  'goal.com': [
    '[class*="ad-"]',
    '[id*="ad-"]',
    '.advertisement',
  ],

  // TalkSport
  'talksport.co.uk': [
    '.ad-unit',
    '[class*="advert"]',
    '[id*="div-gpt"]',
  ],
};

// ── Apply cosmetic filters ─────────────────────────────────────────────────
function applyCosmetics() {
  const selectors = [
    ...(cosmeticRules['*'] || []),
    ...(cosmeticRules[host] || []),
    // Check parent domain
    ...(cosmeticRules[host.replace(/^www\./, '')] || []),
  ];

  if (selectors.length === 0) return;

  let removed = 0;
  selectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        el.remove();
        removed++;
      });
    } catch (e) {}
  });

  if (removed > 0) {
    chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: removed });
  }
}

// ── YouTube ad skip ────────────────────────────────────────────────────────
function skipYouTubeAd() {
  if (!host.includes('youtube.com')) return;

  // Click skip button if present
  const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button');
  if (skipBtn) {
    skipBtn.click();
    chrome.runtime.sendMessage({ type: 'AD_STRIPPED', count: 1 });
    return;
  }

  // If an ad is playing, mute and fast-forward it
  const video = document.querySelector('video');
  const adBadge = document.querySelector('.ad-showing');
  if (video && adBadge) {
    video.muted = true;
    if (video.duration && isFinite(video.duration)) {
      video.currentTime = video.duration;
    }
  }
}

// ── ITVX ad skip ──────────────────────────────────────────────────────────
function skipITVXAd() {
  if (!host.includes('itvx.co.uk') && !host.includes('itv.com')) return;

  const videos = document.querySelectorAll('video');
  if (videos.length < 4) return;

  // Video index 3 is the ad player on ITVX
  // Also scan all videos for one that looks like an ad (short, playing, in fe-mrphs__videoParent)
  videos.forEach((v, i) => {
    if (v.paused) return;
    if (!v.duration || v.duration > 120) return; // Ads are under 2 mins

    const parent = v.closest('[class]');
    const isAdContainer = parent && (
      parent.className.includes('videoParent') ||
      parent.className.includes('ad') ||
      i === 3
    );

    if (isAdContainer) {
      // Dispatch fake ended event to trick player into moving past the ad
      v.dispatchEvent(new Event('ended', { bubbles: true }));
      chrome.runtime.sendMessage({ type: 'AD_STRIPPED', count: 1 });
    }
  });
}

// ── MutationObserver - handles dynamically loaded content ──────────────────
const observer = new MutationObserver(() => {
  applyCosmetics();
  skipYouTubeAd();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Run immediately and on load
applyCosmetics();
document.addEventListener('DOMContentLoaded', applyCosmetics);

if (host.includes('youtube.com')) {
  setInterval(skipYouTubeAd, 300);
}

// ── Dynamic cosmetic filters from storage ─────────────────────────────────
function applyDynamicCosmetics() {
  chrome.storage.local.get(null, (items) => {
    // Find all cosmetic_* keys (from filter lists and custom filters)
    const allCosmetic = [];
    for (const [key, val] of Object.entries(items)) {
      if (key.startsWith('cosmetic_') && Array.isArray(val)) {
        allCosmetic.push(...val);
      }
    }

    allCosmetic.forEach(rule => {
      if (rule.isException) return;
      // Check if rule applies to this host
      const cleanHost = host.replace(/^www\./, '');
      const applies = !rule.domains || rule.domains.length === 0 ||
        rule.domains.some(d => {
          const cleanD = d.replace(/^www\./, '');
          return cleanHost === cleanD || cleanHost.endsWith('.' + cleanD) || d === '*';
        });
      if (!applies) return;

      try {
        document.querySelectorAll(rule.selector).forEach(el => el.remove());
      } catch(e) {}
    });
  });
}

applyDynamicCosmetics();

// Also re-apply when DOM changes
const dynamicObserver = new MutationObserver(() => applyDynamicCosmetics());
dynamicObserver.observe(document.documentElement, { childList: true, subtree: true });

console.log('[adblock] Content script active on', host);
