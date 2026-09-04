// filter-parser.js
// Parses uBlock Origin / EasyList filter syntax into internal rule format

'use strict';

const RESOURCE_TYPES = {
  'script': 'script',
  'image': 'image',
  'stylesheet': 'stylesheet',
  'object': 'object',
  'xmlhttprequest': 'xmlhttprequest',
  'subdocument': 'sub_frame',
  'media': 'media',
  'font': 'font',
  'websocket': 'websocket',
  'ping': 'ping',
  'document': 'main_frame',
};

const ALL_RESOURCE_TYPES = ['script','image','stylesheet','object','xmlhttprequest','sub_frame','media','font','websocket','ping'];

/**
 * Parse a full filter list text into arrays of network and cosmetic rules
 */
function parseFilterList(text) {
  const lines = text.split('\n');
  const networkRules = [];
  const cosmeticRules = [];
  const exceptions = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines, comments, metadata
    if (!line || line.startsWith('!') || line.startsWith('[Adblock')) continue;

    // Cosmetic filter: domain##selector or domain#@#selector (exception)
    if (line.includes('##') || line.includes('#@#')) {
      const cosmetic = parseCosmeticFilter(line);
      if (cosmetic) cosmeticRules.push(cosmetic);
      continue;
    }

    // Exception rule: @@...
    if (line.startsWith('@@')) {
      const exc = parseNetworkFilter(line.slice(2), true);
      if (exc) exceptions.push(exc);
      continue;
    }

    // Network filter
    const net = parseNetworkFilter(line, false);
    if (net) networkRules.push(net);
  }

  return { networkRules, cosmeticRules, exceptions };
}

/**
 * Parse a network filter line into an internal rule object
 */
function parseNetworkFilter(line, isException) {
  // Split off options
  let pattern = line;
  let options = {};
  const optIdx = line.lastIndexOf('$');

  if (optIdx !== -1 && optIdx > 0) {
    const optStr = line.slice(optIdx + 1);
    pattern = line.slice(0, optIdx);
    options = parseOptions(optStr);
  }

  // Skip if unsupported options
  if (options.unsupported) return null;

  // Build URL filter from pattern
  let urlFilter = patternToUrlFilter(pattern);
  if (!urlFilter) return null;

  return {
    urlFilter,
    isException,
    resourceTypes: options.resourceTypes || ALL_RESOURCE_TYPES,
    initiatorDomains: options.initiatorDomains || [],
    excludedInitiatorDomains: options.excludedDomains || [],
    domains: options.domains || [],
    excludedDomains: options.excludedDomains || [],
  };
}

function parseOptions(optStr) {
  const opts = { resourceTypes: null, unsupported: false, initiatorDomains: [], excludedDomains: [], domains: [] };
  const parts = optStr.split(',');
  const types = [];

  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;

    if (p === 'third-party' || p === '3p') continue; // ignore for now
    if (p === 'first-party' || p === '1p') continue;
    if (p === 'important') continue;
    if (p === 'badfilter') { opts.unsupported = true; return opts; }
    if (p.startsWith('csp=')) { opts.unsupported = true; return opts; }
    if (p.startsWith('redirect=') || p.startsWith('redirect-rule=')) { opts.unsupported = true; return opts; }
    if (p.startsWith('rewrite=')) { opts.unsupported = true; return opts; }

    if (p.startsWith('domain=')) {
      const domains = p.slice(7).split('|');
      for (const d of domains) {
        if (d.startsWith('~')) opts.excludedDomains.push(d.slice(1));
        else opts.initiatorDomains.push(d);
      }
      continue;
    }

    const type = RESOURCE_TYPES[p.replace('~', '')];
    if (type) {
      if (!p.startsWith('~')) types.push(type);
    }
  }

  if (types.length > 0) opts.resourceTypes = types;
  return opts;
}

function patternToUrlFilter(pattern) {
  if (!pattern || pattern === '*' || pattern === '/') return null;

  let filter = pattern;

  // || means domain anchor
  if (filter.startsWith('||')) {
    filter = filter.slice(2);
  } else if (filter.startsWith('|')) {
    // | means start of URL — use || for simplicity
    filter = filter.slice(1);
  }

  // Remove trailing |
  if (filter.endsWith('|')) filter = filter.slice(0, -1);

  // ^ is separator — replace with * for our purposes
  // We keep ^ as-is since declarativeNetRequest supports it
  // in urlFilter as a separator wildcard

  // Skip purely regex patterns
  if (filter.startsWith('/') && filter.endsWith('/')) return null;

  // Skip very short or overly broad patterns
  if (filter.length < 4) return null;
  if (filter === '*') return null;

  return '||' + filter;
}

/**
 * Parse a cosmetic filter line
 */
function parseCosmeticFilter(line) {
  const isException = line.includes('#@#');
  const sep = isException ? '#@#' : '##';
  const idx = line.indexOf(sep);

  const domainPart = line.slice(0, idx);
  const selector = line.slice(idx + sep.length).trim();

  if (!selector) return null;

  // Skip complex procedural filters for now
  if (selector.includes(':has(') || selector.includes(':matches-css') ||
      selector.includes(':xpath') || selector.includes(':upward')) return null;

  const domains = domainPart ? domainPart.split(',').map(d => d.trim()).filter(Boolean) : [];

  return {
    selector,
    domains,
    isException,
  };
}

/**
 * Convert internal network rules to declarativeNetRequest rule objects
 */
function toDeclarativeRules(networkRules, startId = 1000) {
  const rules = [];
  let id = startId;

  for (const rule of networkRules) {
    if (!rule.urlFilter) continue;

    const dnrRule = {
      id: id++,
      priority: 1,
      action: { type: rule.isException ? 'allow' : 'block' },
      condition: {
        urlFilter: rule.urlFilter,
        resourceTypes: rule.resourceTypes,
      }
    };

    if (rule.initiatorDomains && rule.initiatorDomains.length > 0) {
      dnrRule.condition.initiatorDomains = rule.initiatorDomains;
    }
    if (rule.excludedInitiatorDomains && rule.excludedInitiatorDomains.length > 0) {
      dnrRule.condition.excludedInitiatorDomains = rule.excludedInitiatorDomains;
    }

    rules.push(dnrRule);
  }

  return rules;
}

// Export for use in background.js and dashboard
if (typeof module !== 'undefined') {
  module.exports = { parseFilterList, toDeclarativeRules };
}
