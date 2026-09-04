// background.js - Service worker

importScripts('filter-parser.js');

// ── Stats ──────────────────────────────────────────────────────────────────
let stats = { today: 0, total: 0, date: new Date().toDateString() };

chrome.storage.local.get(['stats'], (result) => {
  if (result.stats) {
    if (result.stats.date !== new Date().toDateString()) {
      result.stats.today = 0;
      result.stats.date = new Date().toDateString();
    }
    stats = result.stats;
  }
  updateBadge();
});

function saveStats() {
  chrome.storage.local.set({ stats });
}

function incrementStats(count = 1) {
  stats.today += count;
  stats.total += count;
  stats.date = new Date().toDateString();
  saveStats();
  updateBadge();
}

function updateBadge() {
  const count = stats.today;
  const label = count > 9999 ? '9k+' : count > 999 ? Math.floor(count/1000) + 'k' : String(count);
  chrome.action.setBadgeText({ text: label || '0' });
  chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });
}

// ── Page block tracking ────────────────────────────────────────────────────
const pageBlocks = {};

chrome.tabs.onRemoved.addListener((tabId) => {
  delete pageBlocks[tabId];
  savePageBlocks();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    delete pageBlocks[tabId];
    savePageBlocks();
  }
});

function savePageBlocks() {
  chrome.storage.local.set({ pageBlocks });
}

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'GET_STATS':
      sendResponse(stats);
      break;

    case 'AD_BLOCKED':
      incrementStats(msg.count || 1);
      if (tabId) {
        if (!pageBlocks[tabId]) pageBlocks[tabId] = {};
        const domain = msg.domain || 'unknown';
        pageBlocks[tabId][domain] = (pageBlocks[tabId][domain] || 0) + (msg.count || 1);
        savePageBlocks();
      }
      sendResponse({ ok: true });
      break;

    case 'AD_STRIPPED':
      incrementStats(msg.count || 1);
      sendResponse({ ok: true });
      break;

    case 'GET_PAGE_BLOCKS':
      sendResponse(pageBlocks);
      break;

    case 'SYNC_FILTER_LIST':
      syncFilterList(msg.url, msg.id).then(result => sendResponse(result));
      return true;

    case 'GET_FILTER_LISTS':
      chrome.storage.local.get(['filterLists'], (r) => sendResponse(r.filterLists || []));
      return true;

    case 'REMOVE_FILTER_LIST':
      removeFilterList(msg.id).then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_CUSTOM_FILTERS':
      chrome.storage.local.get(['customFilters'], (r) => sendResponse(r.customFilters || ''));
      return true;

    case 'SAVE_CUSTOM_FILTERS':
      saveCustomFilters(msg.text).then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_WHITELIST':
      chrome.storage.local.get(['whitelist'], (r) => sendResponse(r.whitelist || []));
      return true;
  }
  return true;
});

// ── Filter list management ─────────────────────────────────────────────────

async function syncFilterList(url, existingId) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    const { networkRules, cosmeticRules } = parseFilterList(text);
    const id = existingId || 'fl_' + Date.now();

    const { filterLists = [] } = await chrome.storage.local.get('filterLists');
    const existing = filterLists.find(f => f.id === id);

    const listMeta = {
      id, url,
      name: extractListName(text, url),
      networkCount: networkRules.length,
      cosmeticCount: cosmeticRules.length,
      lastSync: new Date().toISOString(),
      enabled: existing ? existing.enabled : true,
    };

    await chrome.storage.local.set({ [`cosmetic_${id}`]: cosmeticRules });
    await applyDynamicNetworkRules(id, networkRules);

    const idx = filterLists.findIndex(f => f.id === id);
    if (idx !== -1) filterLists[idx] = listMeta;
    else filterLists.push(listMeta);
    await chrome.storage.local.set({ filterLists });

    return { ok: true, meta: listMeta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function applyDynamicNetworkRules(listId, networkRules) {
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const base = hashCode(listId) % 50000 + 10000;
  const existingIds = currentRules.filter(r => r.id >= base && r.id < base + 5000).map(r => r.id);
  const dnrRules = toDeclarativeRules(networkRules, base).slice(0, 5000);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: dnrRules,
  });
}

async function removeFilterList(id) {
  const { filterLists = [] } = await chrome.storage.local.get('filterLists');
  const updated = filterLists.filter(f => f.id !== id);
  await chrome.storage.local.set({ filterLists: updated });
  await chrome.storage.local.remove([`cosmetic_${id}`]);

  const base = hashCode(id) % 50000 + 10000;
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = currentRules.filter(r => r.id >= base && r.id < base + 5000).map(r => r.id);
  if (toRemove.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
  }
}

async function saveCustomFilters(text) {
  await chrome.storage.local.set({ customFilters: text });
  const { networkRules, cosmeticRules } = parseFilterList(text);
  await chrome.storage.local.set({ cosmetic_custom: cosmeticRules });
  await applyDynamicNetworkRules('custom', networkRules);
}

function extractListName(text, url) {
  const titleMatch = text.match(/^[!#]\s*(?:Title|Name):\s*(.+)$/mi);
  if (titleMatch) return titleMatch[1].trim();
  return url.split('/').pop().replace(/\.(txt|list)$/i, '');
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ── Periodic sync ──────────────────────────────────────────────────────────
chrome.alarms.create('syncFilterLists', { periodInMinutes: 240 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncFilterLists') syncAllLists();
});

async function syncAllLists() {
  const { filterLists = [] } = await chrome.storage.local.get('filterLists');
  for (const list of filterLists) {
    if (list.enabled) await syncFilterList(list.url, list.id);
  }
}

console.log('[adblock] Background service worker started v2.0');

// ── Popup domain blocker ───────────────────────────────────────────────────
const POPUP_BLOCK_DOMAINS = [
  'hai8g.com',
  'trafficjunky.net',
  'exoclick.com',
  'popads.net',
  'popcash.net',
  'adsterra.com',
  'propellerads.com',
  'hilltopads.net',
  'clickadu.com',
  'juicyads.com',
];

function isPopupDomain(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return POPUP_BLOCK_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && isPopupDomain(changeInfo.url)) {
    chrome.tabs.remove(tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pendingUrl && isPopupDomain(tab.pendingUrl)) {
    chrome.tabs.remove(tab.id);
  }
});
