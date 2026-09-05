// filter-parser.js
// Parses uBlock Origin / EasyList filter syntax into internal rule format

'use strict';

const RESOURCE_TYPES = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  subdocument: 'sub_frame',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  ping: 'ping',
  document: 'main_frame',
};

const ALL_RESOURCE_TYPES = [
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'sub_frame',
  'media',
  'font',
  'websocket',
  'ping',
];

/**
 * Parse a full filter list.
 */
function parseFilterList(text) {
  const lines = text.split(/\r?\n/);

  const networkRules = [];
  const cosmeticRules = [];
  const exceptions = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Empty lines / comments / metadata.
    if (
      !line ||
      line.startsWith('!') ||
      line.startsWith('[Adblock')
    ) {
      continue;
    }

    // Hosts-file entry, e.g.:
    //   0.0.0.0 ads.example.com
    //   127.0.0.1 ads.example.com
    //
    // Convert the hostname to a normal ABP-style domain anchor so the
    // existing DNR conversion path can handle it safely.
    const hostsMatch =
      line.match(
        /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)(?:\s+#.*)?$/
      );

    if (hostsMatch) {
      const hostname =
        hostsMatch[1]
          .trim()
          .toLowerCase()
          .replace(/\.$/, '');

      if (
        hostname &&
        hostname !== 'localhost' &&
        hostname !== 'localhost.localdomain' &&
        /^[a-z0-9.-]+$/.test(hostname) &&
        hostname.includes('.') &&
        !hostname.startsWith('.') &&
        !hostname.endsWith('.') &&
        !hostname.includes('..')
      ) {
        const network =
          parseNetworkFilter(
            `||${hostname}^`,
            false
          );

        if (network) {
          networkRules.push(network);
        }
      }

      continue;
    }

    // Cosmetic filter.
    if (
      line.includes('##') ||
      line.includes('#@#')
    ) {
      const cosmetic =
        parseCosmeticFilter(line);

      if (cosmetic) {
        cosmeticRules.push(cosmetic);
      }

      continue;
    }

    // Network exception.
    if (line.startsWith('@@')) {
      const exception =
        parseNetworkFilter(
          line.slice(2),
          true
        );

      if (exception) {
        exceptions.push(exception);
      }

      continue;
    }

    // Normal network filter.
    const network =
      parseNetworkFilter(
        line,
        false
      );

    if (network) {
      networkRules.push(network);
    }
  }

  return {
    networkRules,
    cosmeticRules,
    exceptions,
  };
}

/**
 * Parse one network filter.
 */
function parseNetworkFilter(
  line,
  isException
) {
  let pattern =
    String(line || '').trim();

  let options = {};

  const optIdx =
    pattern.lastIndexOf('$');

  if (
    optIdx !== -1 &&
    optIdx > 0
  ) {
    const optionText =
      pattern.slice(
        optIdx + 1
      );

    pattern =
      pattern.slice(
        0,
        optIdx
      );

    options =
      parseOptions(
        optionText
      );
  }

  if (
    options.unsupported
  ) {
    return null;
  }

  const urlFilter =
    patternToUrlFilter(
      pattern
    );

  if (!urlFilter) {
    return null;
  }

  return {
    urlFilter,
    isException,

    resourceTypes:
      options.resourceTypes ||
      ALL_RESOURCE_TYPES,

    initiatorDomains:
      options.initiatorDomains ||
      [],

    excludedInitiatorDomains:
      options.excludedDomains ||
      [],

    domains:
      options.domains ||
      [],

    excludedDomains:
      options.excludedDomains ||
      [],
  };
}

/**
 * Parse ABP/uBO network options.
 *
 * Unsupported options are skipped conservatively rather than generating
 * a malformed Chrome DNR rule.
 */
function parseOptions(
  optionText
) {
  const opts = {
    resourceTypes: null,
    unsupported: false,
    initiatorDomains: [],
    excludedDomains: [],
    domains: [],
  };

  const parts =
    optionText.split(',');

  const types = [];

  for (const rawPart of parts) {
    const p =
      rawPart.trim();

    if (!p) {
      continue;
    }

    // Currently tolerated.
    if (
      p === 'third-party' ||
      p === '3p' ||
      p === 'first-party' ||
      p === '1p' ||
      p === 'important'
    ) {
      continue;
    }

    // Explicitly unsupported uBO/ABP features.
    if (
      p === 'badfilter' ||
      p.startsWith('csp=') ||
      p.startsWith('redirect=') ||
      p.startsWith('redirect-rule=') ||
      p.startsWith('rewrite=') ||
      p.startsWith('removeparam=') ||
      p === 'removeparam' ||
      p.startsWith('replace=') ||
      p.startsWith('urlskip=') ||
      p.startsWith('permissions=') ||
      p.startsWith('header=') ||
      p.startsWith('ipaddress=') ||
      p.startsWith('method=') ||
      p.startsWith('denyallow=') ||
      p.startsWith('to=') ||
      p.startsWith('from=')
    ) {
      opts.unsupported = true;
      return opts;
    }

    // domain=example.com|~excluded.com
    if (
      p.startsWith(
        'domain='
      )
    ) {
      const domains =
        p.slice(7)
          .split('|');

      for (const domainEntry of domains) {
        const d =
          domainEntry.trim();

        if (!d) {
          continue;
        }

        if (
          d.startsWith('~')
        ) {
          const excluded =
            d.slice(1);

          if (excluded) {
            opts.excludedDomains.push(
              excluded
            );
          }
        } else {
          opts.initiatorDomains.push(
            d
          );
        }
      }

      continue;
    }

    const negated =
      p.startsWith('~');

    const optionName =
      negated
        ? p.slice(1)
        : p;

    const type =
      RESOURCE_TYPES[
        optionName
      ];

    if (type) {
      /*
       * Positive resource-type options are supported directly.
       *
       * Negated resource types such as ~image are not currently translated
       * because doing so incorrectly could make a rule much broader than
       * intended. Skip the whole filter instead.
       */
      if (negated) {
        opts.unsupported = true;
        return opts;
      }

      types.push(type);
      continue;
    }

    /*
     * Unknown option.
     *
     * Be conservative: skipping one unsupported filter is preferable to
     * generating an invalid DNR rule and causing Chrome to reject the entire
     * filter-list update.
     */
    opts.unsupported = true;
    return opts;
  }

  if (
    types.length > 0
  ) {
    opts.resourceTypes =
      [...new Set(types)];
  }

  return opts;
}

/**
 * Convert an ABP/uBO URL pattern into a Chrome DNR urlFilter.
 *
 * Important:
 * Do NOT blindly prefix every filter with "||".
 *
 * A plain ABP substring filter and a domain-anchored filter are different
 * things, and forcing "||" onto arbitrary patterns can create invalid DNR
 * syntax.
 */
function patternToUrlFilter(
  input
) {
  if (!input) {
    return null;
  }

  let filter =
    String(input).trim();

  if (
    !filter ||
    filter === '*' ||
    filter === '/'
  ) {
    return null;
  }

  // Pure regular-expression filters are not handled by this parser.
  if (
    filter.length >= 2 &&
    filter.startsWith('/') &&
    filter.endsWith('/')
  ) {
    return null;
  }

  // Chrome DNR urlFilter is not a place for multiline/control characters.
  if (
    /[\r\n\t]/.test(filter)
  ) {
    return null;
  }

  // Spaces generally indicate syntax we do not understand safely.
  if (
    /\s/.test(filter)
  ) {
    return null;
  }

  /*
   * Keep this parser ASCII-only for DNR URL filters.
   * Internationalised hostnames in actual URLs are represented using
   * punycode, so silently producing a malformed rule is worse than skipping.
   */
  if (
    /[^\x20-\x7E]/.test(
      filter
    )
  ) {
    return null;
  }

  // Avoid absurd / malformed filters.
  if (
    filter.length > 2000
  ) {
    return null;
  }

  /*
   * ABP "|" anchors are only meaningful at the beginning/end of a filter,
   * or as the initial "||" domain anchor.
   *
   * An internal pipe generally means syntax we cannot safely convert.
   */
  let bodyForPipeCheck =
    filter;

  if (
    bodyForPipeCheck.startsWith(
      '||'
    )
  ) {
    bodyForPipeCheck =
      bodyForPipeCheck.slice(2);
  } else if (
    bodyForPipeCheck.startsWith(
      '|'
    )
  ) {
    bodyForPipeCheck =
      bodyForPipeCheck.slice(1);
  }

  if (
    bodyForPipeCheck.endsWith(
      '|'
    )
  ) {
    bodyForPipeCheck =
      bodyForPipeCheck.slice(
        0,
        -1
      );
  }

  if (
    bodyForPipeCheck.includes(
      '|'
    )
  ) {
    return null;
  }

  /*
   * Reject obvious extended/procedural syntax if it somehow reaches the
   * network parser.
   */
  if (
    filter.includes('##') ||
    filter.includes('#@#') ||
    filter.includes('#?#') ||
    filter.includes('#$#') ||
    filter.includes('#%#')
  ) {
    return null;
  }

  /*
   * A filter consisting effectively only of anchors/wildcards/separators is
   * too broad and can also be rejected by DNR.
   */
  const meaningful =
    filter
      .replace(/^\|\|?/, '')
      .replace(/\|$/, '')
      .replace(/[\*\^]/g, '');

  if (
    meaningful.length < 3
  ) {
    return null;
  }

  /*
   * Preserve the pattern exactly.
   *
   * Examples:
   *
   *   ||ads.example.com^
   *   |https://example.com/ad.js
   *   /advertising/
   *   ads/banner
   *
   * Chrome DNR understands the standard *, ^ and | urlFilter tokens.
   */
  return filter;
}

/**
 * Parse cosmetic filter.
 */
function parseCosmeticFilter(
  line
) {
  const isException =
    line.includes('#@#');

  const separator =
    isException
      ? '#@#'
      : '##';

  const idx =
    line.indexOf(
      separator
    );

  if (idx === -1) {
    return null;
  }

  const domainPart =
    line.slice(
      0,
      idx
    );

  const selector =
    line.slice(
      idx +
      separator.length
    ).trim();

  if (!selector) {
    return null;
  }

  // Extended procedural cosmetic filters are not supported yet.
  if (
    selector.includes(
      ':matches-css'
    ) ||
    selector.includes(
      ':xpath'
    ) ||
    selector.includes(
      ':upward'
    )
  ) {
    return null;
  }

  /*
   * :has() itself is deliberately NOT rejected here.
   * Modern Chromium supports CSS :has(), and our CSS-first cosmetic engine
   * can use ordinary valid :has() selectors.
   */

  const domains =
    domainPart
      ? domainPart
          .split(',')
          .map(
            d =>
              d.trim()
          )
          .filter(Boolean)
      : [];

  return {
    selector,
    domains,
    isException,
  };
}

/**
 * Convert internal network rules into Chrome DNR rules.
 */
function toDeclarativeRules(
  networkRules,
  startId = 1000
) {
  const rules = [];

  let id =
    startId;

  for (
    const rule
    of networkRules
  ) {
    if (
      !rule ||
      !rule.urlFilter
    ) {
      continue;
    }

    const dnrRule = {
      id:
        id++,

      // Exceptions must outrank ordinary block rules.
      priority:
        rule.isException
          ? 2
          : 1,

      action: {
        type:
          rule.isException
            ? 'allow'
            : 'block',
      },

      condition: {
        urlFilter:
          rule.urlFilter,

        resourceTypes:
          rule.resourceTypes,
      },
    };

    if (
      rule.initiatorDomains &&
      rule.initiatorDomains.length >
        0
    ) {
      dnrRule.condition.initiatorDomains =
        rule.initiatorDomains;
    }

    if (
      rule.excludedInitiatorDomains &&
      rule.excludedInitiatorDomains.length >
        0
    ) {
      dnrRule.condition.excludedInitiatorDomains =
        rule.excludedInitiatorDomains;
    }

    rules.push(
      dnrRule
    );
  }

  return rules;
}

// Export for tests / dashboard usage.
if (
  typeof module !==
  'undefined'
) {
  module.exports = {
    parseFilterList,
    toDeclarativeRules,
  };
}