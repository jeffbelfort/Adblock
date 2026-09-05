// background.js - Service worker

importScripts('filter-parser.js');

const DEFAULT_SETTINGS = {
  requests: true,
  cosmetic: true,
  youtube: true,
  itvx: true,
  soundcloud: true,
  autosync: true,
};

const STATIC_RULESETS = ['block_ads', 'block_youtube', 'block_streaming'];
const GLOBAL_ALLOW_RULE_ID = 9000001;
const WHITELIST_RULE_BASE = 9100000;
const WHITELIST_RULE_LIMIT = 500;

// Dynamic DNR allocation.
//
// Chrome 121+ supports up to 30,000 safe dynamic rules per extension.
// Each filter source receives a large, permanently separated ID namespace;
// the actual installed rule count is governed by the extension-wide quota,
// not by the size of the ID namespace.
const DNR_MAX_DYNAMIC_RULES = 30000;
const DNR_ID_RANGE_SIZE = 100000;
const DNR_RANGE_START = 100000;
const DNR_RANGE_MAP_KEY = 'dnrRangeMap';

let cachedSettings = { ...DEFAULT_SETTINGS };
let cachedWhitelist = [];

// Resource types used only for the high-priority session allow rule.
// Named differently from filter-parser.js to avoid a top-level const collision.
const SESSION_ALLOW_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket',
  'webtransport', 'webbundle', 'other'
];

function normaliseDomain(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/^www\./, '');
}

function hostnameMatchesWhitelist(hostname) {
  const clean = normaliseDomain(hostname);

  return cachedWhitelist.some(entry => {
    const domain = normaliseDomain(entry);

    return (
      domain &&
      (
        clean === domain ||
        clean.endsWith('.' + domain)
      )
    );
  });
}

async function loadProtectionState() {
  const data = await chrome.storage.local.get([
    'settings',
    'whitelist',
  ]);

  cachedSettings = {
    ...DEFAULT_SETTINGS,
    ...(data.settings || {}),
  };

  cachedWhitelist =
    Array.isArray(data.whitelist)
      ? data.whitelist
      : [];
}

async function syncStaticRulesets() {
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  const wanted = {
    block_ads:
      cachedSettings.requests !== false,

    block_youtube:
      cachedSettings.requests !== false &&
      cachedSettings.youtube !== false,

    block_streaming:
      cachedSettings.requests !== false &&
      cachedSettings.itvx !== false,
  };

  for (const id of STATIC_RULESETS) {
    (
      wanted[id]
        ? enableRulesetIds
        : disableRulesetIds
    ).push(id);
  }

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}

async function syncSessionProtectionRules() {
  const existing =
    await chrome.declarativeNetRequest.getSessionRules();

  const managedIds =
    existing
      .filter(rule =>
        rule.id === GLOBAL_ALLOW_RULE_ID ||
        (
          rule.id >= WHITELIST_RULE_BASE &&
          rule.id <
            WHITELIST_RULE_BASE +
            WHITELIST_RULE_LIMIT
        )
      )
      .map(rule => rule.id);

  const addRules = [];

  // Requests disabled = allow everything through the dynamic/static request layer.
  if (cachedSettings.requests === false) {
    addRules.push({
      id: GLOBAL_ALLOW_RULE_ID,
      priority: 100000,
      action: {
        type: 'allow',
      },
      condition: {
        urlFilter: '|http',
        resourceTypes:
          SESSION_ALLOW_RESOURCE_TYPES,
      },
    });
  }

  // Whitelisted sites receive a high-priority allowAllRequests rule.
  cachedWhitelist
    .map(normaliseDomain)
    .filter(Boolean)
    .slice(0, WHITELIST_RULE_LIMIT)
    .forEach((domain, index) => {
      addRules.push({
        id:
          WHITELIST_RULE_BASE +
          index,

        priority: 100001,

        action: {
          type: 'allowAllRequests',
        },

        condition: {
          requestDomains: [
            domain,
          ],

          resourceTypes: [
            'main_frame',
            'sub_frame',
          ],
        },
      });
    });

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: managedIds,
    addRules,
  });
}

async function syncProtectionRules() {
  try {
    await loadProtectionState();
    await syncStaticRulesets();
    await syncSessionProtectionRules();
  } catch (err) {
    console.error(
      '[adblock] Failed to sync protection settings:',
      err
    );
  }
}

chrome.runtime.onInstalled.addListener(
  syncProtectionRules
);

chrome.runtime.onStartup.addListener(
  syncProtectionRules
);

syncProtectionRules();

chrome.storage.onChanged.addListener(
  (changes, area) => {
    if (area !== 'local') {
      return;
    }

    if (
      changes.settings ||
      changes.whitelist
    ) {
      syncProtectionRules();
    }
  }
);

// ── Stats ──────────────────────────────────────────────────────────────────

let stats = {
  today: 0,
  total: 0,
  date: new Date().toDateString(),
};

chrome.storage.local.get(
  ['stats'],
  result => {
    if (result.stats) {
      if (
        result.stats.date !==
        new Date().toDateString()
      ) {
        result.stats.today = 0;
        result.stats.date =
          new Date().toDateString();
      }

      stats = result.stats;
    }

    updateBadge();
  }
);

function saveStats() {
  chrome.storage.local.set({
    stats,
  });
}

function incrementStats(count = 1) {
  stats.today += count;
  stats.total += count;
  stats.date =
    new Date().toDateString();

  saveStats();
  updateBadge();
}

function updateBadge() {
  const count = stats.today;

  const label =
    count > 9999
      ? '9k+'
      : count > 999
        ? Math.floor(count / 1000) + 'k'
        : String(count);

  chrome.action.setBadgeText({
    text: label || '0',
  });

  chrome.action.setBadgeBackgroundColor({
    color: '#1D9E75',
  });
}

// ── Page block tracking ────────────────────────────────────────────────────

const pageBlocks = {};

chrome.tabs.onRemoved.addListener(
  tabId => {
    delete pageBlocks[tabId];
    savePageBlocks();
  }
);

chrome.tabs.onUpdated.addListener(
  (tabId, info) => {
    if (info.status === 'loading') {
      delete pageBlocks[tabId];
      savePageBlocks();
    }
  }
);

function savePageBlocks() {
  chrome.storage.local.set({
    pageBlocks,
  });
}

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    msg,
    sender,
    sendResponse
  ) => {
    const tabId =
      sender.tab?.id;

    switch (msg.type) {
      case 'GET_STATS':
        sendResponse(stats);
        break;

      case 'AD_BLOCKED':
        incrementStats(
          msg.count || 1
        );

        if (tabId) {
          if (!pageBlocks[tabId]) {
            pageBlocks[tabId] = {};
          }

          const domain =
            msg.domain ||
            'unknown';

          pageBlocks[tabId][domain] =
            (
              pageBlocks[tabId][domain] ||
              0
            ) +
            (
              msg.count ||
              1
            );

          savePageBlocks();
        }

        sendResponse({
          ok: true,
        });

        break;

      case 'AD_STRIPPED':
        incrementStats(
          msg.count || 1
        );

        sendResponse({
          ok: true,
        });

        break;

      case 'GET_PAGE_BLOCKS':
        sendResponse(
          pageBlocks
        );

        break;

      case 'SYNC_FILTER_LIST':
        syncFilterList(
          msg.url,
          msg.id
        ).then(
          result =>
            sendResponse(
              result
            )
        );

        return true;

      case 'GET_FILTER_LISTS':
        chrome.storage.local.get(
          ['filterLists'],
          r =>
            sendResponse(
              r.filterLists ||
              []
            )
        );

        return true;

      case 'REMOVE_FILTER_LIST':
        removeFilterList(
          msg.id
        ).then(() =>
          sendResponse({
            ok: true,
          })
        );

        return true;

      case 'GET_CUSTOM_FILTERS':
        chrome.storage.local.get(
          ['customFilters'],
          r =>
            sendResponse(
              r.customFilters ||
              ''
            )
        );

        return true;

      case 'SAVE_CUSTOM_FILTERS':
        saveCustomFilters(
          msg.text
        ).then(() =>
          sendResponse({
            ok: true,
          })
        );

        return true;

      case 'GET_WHITELIST':
        chrome.storage.local.get(
          ['whitelist'],
          r =>
            sendResponse(
              r.whitelist ||
              []
            )
        );

        return true;
    }

    return true;
  }
);

// ── Filter list management ─────────────────────────────────────────────────

const FILTER_INCLUDE_MAX_DEPTH = 8;
const FILTER_INCLUDE_MAX_FILES = 64;

async function fetchFilterListWithIncludes(
  url,
  state = null,
  depth = 0
) {
  if (depth > FILTER_INCLUDE_MAX_DEPTH) {
    throw new Error(
      `Filter include depth exceeded at ${url}`
    );
  }

  const includeState =
    state || {
      visited: new Set(),
      fileCount: 0,
    };

  const absoluteUrl =
    new URL(url).href;

  if (includeState.visited.has(absoluteUrl)) {
    return '';
  }

  if (
    includeState.fileCount >=
    FILTER_INCLUDE_MAX_FILES
  ) {
    throw new Error(
      'Filter include file limit exceeded'
    );
  }

  includeState.visited.add(absoluteUrl);
  includeState.fileCount++;

  const resp =
    await fetch(absoluteUrl);

  if (!resp.ok) {
    throw new Error(
      `HTTP ${resp.status} while loading ${absoluteUrl}`
    );
  }

  const text =
    await resp.text();

  const output = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const includeMatch =
      rawLine.match(
        /^\s*!#include\s+(.+?)\s*$/
      );

    if (!includeMatch) {
      output.push(rawLine);
      continue;
    }

    const includeTarget =
      includeMatch[1]
        .trim()
        .replace(
          /^["']|["']$/g,
          ''
        );

    if (
      !includeTarget ||
      /^(?:data|javascript|file):/i.test(
        includeTarget
      )
    ) {
      continue;
    }

    let includeUrl;

    try {
      includeUrl =
        new URL(
          includeTarget,
          absoluteUrl
        );
    } catch {
      continue;
    }

    if (
      includeUrl.protocol !== 'https:' &&
      includeUrl.protocol !== 'http:'
    ) {
      continue;
    }

    const includedText =
      await fetchFilterListWithIncludes(
        includeUrl.href,
        includeState,
        depth + 1
      );

    if (includedText) {
      output.push(includedText);
    }
  }

  return output.join('\n');
}


async function syncFilterList(
  url,
  existingId
) {
  try {
    const text =
      await fetchFilterListWithIncludes(
        url
      );

    const {
      networkRules,
      cosmeticRules,
      exceptions,
    } =
      parseFilterList(text);

    const id =
      existingId ||
      'fl_' +
        Date.now();

    const {
      filterLists = [],
    } =
      await chrome.storage.local.get(
        'filterLists'
      );

    const existing =
      filterLists.find(
        f => f.id === id
      );

    const parsedNetworkCount =
      networkRules.length +
      exceptions.length;

    await chrome.storage.local.set({
      [`cosmetic_${id}`]:
        cosmeticRules,
    });

    const installResult =
      await applyDynamicNetworkRules(
        id,
        [
          ...networkRules,
          ...exceptions,
        ],
        {
          id,
          url,
          name:
            extractListName(
              text,
              url
            ),
          enabled:
            existing
              ? existing.enabled
              : true,
        }
      );

    const listMeta = {
      id,
      url,

      name:
        extractListName(
          text,
          url
        ),

      // Number actually installed into Chrome DNR.
      networkCount:
        installResult.installedCount,

      // Total number successfully parsed from the source list.
      parsedNetworkCount,

      // Explicit installed count for future dashboard display.
      installedNetworkCount:
        installResult.installedCount,

      // Number omitted because this source exceeded its DNR slot.
      truncatedNetworkCount:
        installResult.truncatedCount,

      cosmeticCount:
        cosmeticRules.length,

      lastSync:
        new Date().toISOString(),

      enabled:
        existing
          ? existing.enabled
          : true,
    };

    const idx =
      filterLists.findIndex(
        f => f.id === id
      );

    if (idx !== -1) {
      filterLists[idx] =
        listMeta;
    } else {
      filterLists.push(
        listMeta
      );
    }

    await chrome.storage.local.set({
      filterLists,
    });

    return {
      ok: true,
      meta: listMeta,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err.message,
    };
  }
}

// ── Dynamic DNR global allocator ─────────────────────────────────────────────

async function getDnrRangeMap() {
  const data =
    await chrome.storage.local.get(
      DNR_RANGE_MAP_KEY
    );

  const map =
    data[DNR_RANGE_MAP_KEY];

  return (
    map &&
    typeof map === 'object' &&
    !Array.isArray(map)
  )
    ? map
    : {};
}


async function getOrAllocateDnrRangeBase(
  listId
) {
  const map =
    await getDnrRangeMap();

  if (
    Number.isInteger(map[listId]) &&
    map[listId] >= 0
  ) {
    return (
      DNR_RANGE_START +
      (
        map[listId] *
        DNR_ID_RANGE_SIZE
      )
    );
  }

  const usedSlots =
    new Set(
      Object.values(map)
        .filter(
          slot =>
            Number.isInteger(slot) &&
            slot >= 0
        )
    );

  let slot = 0;

  while (usedSlots.has(slot)) {
    slot++;
  }

  map[listId] = slot;

  await chrome.storage.local.set({
    [DNR_RANGE_MAP_KEY]: map,
  });

  return (
    DNR_RANGE_START +
    (
      slot *
      DNR_ID_RANGE_SIZE
    )
  );
}


async function releaseDnrRange(
  listId
) {
  const map =
    await getDnrRangeMap();

  if (!(listId in map)) {
    return;
  }

  delete map[listId];

  await chrome.storage.local.set({
    [DNR_RANGE_MAP_KEY]: map,
  });
}


// Used only for cleaning up rules created by older versions.
function legacyDnrRangeBase(
  listId
) {
  return (
    hashCode(listId) %
    50000
  ) + 10000;
}


function getManagedDynamicRuleIds(
  currentRules,
  map,
  listId
) {
  const slot =
    map[listId];

  const base =
    Number.isInteger(slot)
      ? (
          DNR_RANGE_START +
          (
            slot *
            DNR_ID_RANGE_SIZE
          )
        )
      : null;

  const legacyBase =
    legacyDnrRangeBase(
      listId
    );

  return currentRules
    .filter(rule =>
      (
        base !== null &&
        rule.id >= base &&
        rule.id <
          base +
          DNR_ID_RANGE_SIZE
      ) ||
      (
        rule.id >= legacyBase &&
        rule.id <
          legacyBase +
          5000
      )
    )
    .map(rule => rule.id);
}


function distributeRuleCapacity(
  sources,
  capacity
) {
  const allocations = {};

  for (const source of sources) {
    allocations[source.id] = 0;
  }

  let remaining = capacity;

  let active =
    sources.filter(
      source =>
        source.generatedRules.length > 0
    );

  // Water-filling allocation: small lists get what they need and
  // unused capacity is redistributed among larger lists.
  while (
    remaining > 0 &&
    active.length > 0
  ) {
    const fairShare =
      Math.max(
        1,
        Math.floor(
          remaining /
          active.length
        )
      );

    let usedThisRound = 0;

    for (const source of active) {
      if (remaining <= 0) {
        break;
      }

      const alreadyAllocated =
        allocations[source.id];

      const stillNeeded =
        source.generatedRules.length -
        alreadyAllocated;

      if (stillNeeded <= 0) {
        continue;
      }

      const amount =
        Math.min(
          stillNeeded,
          fairShare,
          remaining
        );

      allocations[source.id] += amount;
      remaining -= amount;
      usedThisRound += amount;
    }

    active =
      active.filter(
        source =>
          allocations[source.id] <
          source.generatedRules.length
      );

    if (usedThisRound === 0) {
      break;
    }
  }

  return allocations;
}


async function loadNetworkSource(
  list,
  overrideSource
) {
  if (
    overrideSource &&
    overrideSource.id === list.id
  ) {
    return {
      id: list.id,
      list,
      generatedRules:
        overrideSource.generatedRules,
    };
  }

  const text =
    await fetchFilterListWithIncludes(
      list.url
    );

  const {
    networkRules,
    exceptions,
  } =
    parseFilterList(text);

  const base =
    await getOrAllocateDnrRangeBase(
      list.id
    );

  return {
    id: list.id,
    list,

    generatedRules:
      toDeclarativeRules(
        [
          ...networkRules,
          ...exceptions,
        ],
        base
      ),
  };
}


async function rebuildDynamicNetworkRules(
  overrideSource = null
) {
  const {
    filterLists = [],
  } =
    await chrome.storage.local.get(
      'filterLists'
    );

  const lists =
    filterLists.filter(
      list =>
        list.enabled !== false
    );

  // A newly-added list is not yet stored in filterLists on its first sync.
  if (
    overrideSource &&
    overrideSource.list &&
    !lists.some(
      list =>
        list.id === overrideSource.id
    )
  ) {
    lists.push(
      overrideSource.list
    );
  }

  const sources = [];

  for (const list of lists) {
    try {
      const source =
        await loadNetworkSource(
          list,
          overrideSource
        );

      sources.push(source);
    } catch (err) {
      console.error(
        `[adblock] Failed to load network rules for ${list.name || list.url}:`,
        err
      );
    }
  }

  // Custom filters participate in the same global quota.
  const {
    customFilters = '',
  } =
    await chrome.storage.local.get(
      'customFilters'
    );

  if (
    customFilters &&
    (!overrideSource ||
      overrideSource.id !== 'custom')
  ) {
    const {
      networkRules,
      exceptions,
    } =
      parseFilterList(customFilters);

    const base =
      await getOrAllocateDnrRangeBase(
        'custom'
      );

    sources.push({
      id: 'custom',
      list: null,
      generatedRules:
        toDeclarativeRules(
          [
            ...networkRules,
            ...exceptions,
          ],
          base
        ),
    });
  } else if (
    overrideSource &&
    overrideSource.id === 'custom'
  ) {
    sources.push({
      id: 'custom',
      list: null,
      generatedRules:
        overrideSource.generatedRules,
    });
  }

  const allocations =
    distributeRuleCapacity(
      sources,
      DNR_MAX_DYNAMIC_RULES
    );

  const currentRules =
    await chrome.declarativeNetRequest
      .getDynamicRules();

  const map =
    await getDnrRangeMap();

  const managedIds =
    new Set();

  for (const listId of Object.keys(map)) {
    for (
      const id of
      getManagedDynamicRuleIds(
        currentRules,
        map,
        listId
      )
    ) {
      managedIds.add(id);
    }
  }

  const addRules = [];
  const results = {};

  for (const source of sources) {
    const installedCount =
      allocations[source.id] || 0;

    addRules.push(
      ...source.generatedRules.slice(
        0,
        installedCount
      )
    );

    results[source.id] = {
      generatedCount:
        source.generatedRules.length,

      installedCount,

      truncatedCount:
        Math.max(
          0,
          source.generatedRules.length -
          installedCount
        ),
    };
  }

  await chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds:
        [...managedIds],

      addRules,
    });

  // Keep dashboard metadata accurate for every subscribed list.
  const latest =
    await chrome.storage.local.get(
      'filterLists'
    );

  const updatedLists =
    Array.isArray(latest.filterLists)
      ? latest.filterLists
      : [];

  let metadataChanged = false;

  for (const list of updatedLists) {
    const result =
      results[list.id];

    if (!result) {
      continue;
    }

    list.networkCount =
      result.installedCount;

    list.installedNetworkCount =
      result.installedCount;

    list.parsedNetworkCount =
      result.generatedCount;

    list.truncatedNetworkCount =
      result.truncatedCount;

    metadataChanged = true;
  }

  if (metadataChanged) {
    await chrome.storage.local.set({
      filterLists:
        updatedLists,
    });
  }

  return results;
}


async function applyDynamicNetworkRules(
  listId,
  networkRules,
  list = null
) {
  const base =
    await getOrAllocateDnrRangeBase(
      listId
    );

  const generatedRules =
    toDeclarativeRules(
      networkRules,
      base
    );

  const results =
    await rebuildDynamicNetworkRules({
      id: listId,
      list,
      generatedRules,
    });

  return (
    results[listId] || {
      generatedCount:
        generatedRules.length,

      installedCount: 0,

      truncatedCount:
        generatedRules.length,
    }
  );
}


async function removeFilterList(
  id
) {
  const {
    filterLists = [],
  } =
    await chrome.storage.local.get(
      'filterLists'
    );

  const updated =
    filterLists.filter(
      f => f.id !== id
    );

  await chrome.storage.local.set({
    filterLists:
      updated,
  });

  await chrome.storage.local.remove([
    `cosmetic_${id}`,
  ]);

  const currentRules =
    await chrome.declarativeNetRequest
      .getDynamicRules();

  const map =
    await getDnrRangeMap();

  const toRemove =
    getManagedDynamicRuleIds(
      currentRules,
      map,
      id
    );

  if (toRemove.length > 0) {
    await chrome.declarativeNetRequest
      .updateDynamicRules({
        removeRuleIds:
          [...new Set(toRemove)],
      });
  }

  await releaseDnrRange(id);

  // Redistribute the freed quota among remaining sources.
  await rebuildDynamicNetworkRules();
}


async function saveCustomFilters(
  text
) {
  await chrome.storage.local.set({
    customFilters:
      text,
  });

  const {
    networkRules,
    cosmeticRules,
    exceptions,
  } =
    parseFilterList(text);

  await chrome.storage.local.set({
    cosmetic_custom:
      cosmeticRules,
  });

  await applyDynamicNetworkRules(
    'custom',
    [
      ...networkRules,
      ...exceptions,
    ]
  );
}

function extractListName(
  text,
  url
) {
  const titleMatch =
    text.match(
      /^[!#]\s*(?:Title|Name):\s*(.+)$/mi
    );

  if (titleMatch) {
    return (
      titleMatch[1]
        .trim()
    );
  }

  return url
    .split('/')
    .pop()
    .replace(
      /\.(txt|list)$/i,
      ''
    );
}

function hashCode(str) {
  let hash = 0;

  for (
    let i = 0;
    i < str.length;
    i++
  ) {
    hash =
      (
        (
          hash << 5
        ) -
        hash
      ) +
      str.charCodeAt(
        i
      );

    hash |= 0;
  }

  return Math.abs(
    hash
  );
}

// ── Periodic sync ──────────────────────────────────────────────────────────

chrome.alarms.create(
  'syncFilterLists',
  {
    periodInMinutes:
      240,
  }
);

chrome.alarms.onAlarm.addListener(
  async alarm => {
    if (
      alarm.name !==
      'syncFilterLists'
    ) {
      return;
    }

    await loadProtectionState();

    if (
      cachedSettings.autosync !==
      false
    ) {
      syncAllLists();
    }
  }
);

async function syncAllLists() {
  const {
    filterLists = [],
  } =
    await chrome.storage.local.get(
      'filterLists'
    );

  for (
    const list
    of filterLists
  ) {
    if (
      list.enabled
    ) {
      await syncFilterList(
        list.url,
        list.id
      );
    }
  }
}

console.log(
  '[adblock] Background service worker started v2.0'
);

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

function isPopupDomain(
  url
) {
  if (!url) {
    return false;
  }

  try {
    const hostname =
      new URL(
        url
      ).hostname;

    return (
      POPUP_BLOCK_DOMAINS
        .some(
          d =>
            hostname === d ||
            hostname.endsWith(
              '.' + d
            )
        )
    );
  } catch {
    return false;
  }
}

async function tabIsWhitelisted(
  tabId
) {
  if (!tabId) {
    return false;
  }

  try {
    const tab =
      await chrome.tabs.get(
        tabId
      );

    if (!tab?.url) {
      return false;
    }

    return hostnameMatchesWhitelist(
      new URL(
        tab.url
      ).hostname
    );
  } catch {
    return false;
  }
}

chrome.tabs.onUpdated.addListener(
  async (
    tabId,
    changeInfo
  ) => {
    if (
      !changeInfo.url ||
      !isPopupDomain(
        changeInfo.url
      )
    ) {
      return;
    }

    if (
      cachedSettings.requests ===
      false
    ) {
      return;
    }

    const tab =
      await chrome.tabs
        .get(
          tabId
        )
        .catch(
          () => null
        );

    if (
      tab?.openerTabId &&
      await tabIsWhitelisted(
        tab.openerTabId
      )
    ) {
      return;
    }

    chrome.tabs
      .remove(
        tabId
      )
      .catch(
        () => {}
      );
  }
);

chrome.tabs.onCreated.addListener(
  async tab => {
    if (
      !tab.pendingUrl ||
      !isPopupDomain(
        tab.pendingUrl
      )
    ) {
      return;
    }

    if (
      cachedSettings.requests ===
      false
    ) {
      return;
    }

    if (
      tab.openerTabId &&
      await tabIsWhitelisted(
        tab.openerTabId
      )
    ) {
      return;
    }

    chrome.tabs
      .remove(
        tab.id
      )
      .catch(
        () => {}
      );
  }
);