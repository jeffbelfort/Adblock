# Adblock Firefox port — development build

Based on the uploaded extension version 2.0.0, including your local changes.
The original Chrome extension is not overwritten. This archive contains a
separate extension-firefox directory. Requires Firefox 142 or newer.

## First test

1. Extract this archive into your project directory so extension-firefox sits
   beside extension, dns and dashboard.
2. Open about:debugging#/runtime/this-firefox in Firefox.
3. Click Load Temporary Add-on and select extension-firefox/manifest.json.
4. Open the toolbar Extensions menu and pin Adblock (Firefox), if desired.
5. In about:addons, inspect the extension's Permissions and grant website access
   if Firefox asks. Reload already-open test websites after loading the add-on.
6. Open the popup and extension options/dashboard. Check toggles and settings.

## What changed

- Firefox uses manifest background.scripts instead of Chrome's service worker.
- filter-parser.js loads before background.js, without importScripts.
- Extension-context code uses Firefox's browser namespace; MAIN-world site
  scripts are retained as supplied.
- Dynamic network-filter allocation uses the browser's actual rule limit
  (normally 5,000 in Firefox), rather than assuming Chrome's 30,000.
- Removed Chrome-only webbundle/webtransport values from the session allow rule.
- Added a stable Firefox add-on ID and no-data-collection declaration. Filter
  subscriptions still contact the URLs you choose; local statistics stay local.
- Removed Chrome-generated _metadata and the .jsbak backup from the package.
- DNS Start/Stop buttons open the trusted localhost dashboard. A direct link is
  also available at the bottom of the extension dashboard. The Go dashboard's
  token, Host and Origin checks have NOT been weakened. DNS read panels in the
  extension may show unavailable because that API rejects extension origins;
  view DNS statistics and manage DNS at http://localhost:9001/ instead.
- Hardened popup count rendering by coercing stored counts to numbers.

## What does NOT transfer automatically

Chrome extension storage is separate from Firefox storage. Subscribed filter
lists, whitelist entries, custom browser filters and browser-side history must
be added again or explicitly migrated. Your DNS blocklists are unchanged and
remain managed by the Linux DNS service.

A browser whitelist affects the extension only. It cannot override a domain
blocked by your system DNS layer. Turning the extension off does not stop DNS.
Stopping the DNS service does not switch system DNS back to automatic and can
break name lookups; keep DNS running during initial extension testing.

## Checks completed

- JavaScript syntax checks on all supplied JS files.
- Mozilla web-ext lint: zero errors; remaining warnings concern existing dynamic
  innerHTML rendering in dashboard.js. User-visible strings there use the
  project's escaping helper; lint is not a comprehensive security audit.
- Node VM tests of background startup, enabled rulesets, request protection
  toggle, whitelist rules, browser quota selection, filter parsing, manifest
  file references and the 57 supplied static rules.

These checks do not substitute for Firefox runtime/site tests. No actual browser
or streaming-service playback test was possible here. The supplied site scripts
are retained; Netflix/ITVX/YouTube functionality is not guaranteed by this port.

## Restart and permanent installation

A temporary add-on is removed when Firefox exits. For a PC reboot test, verify
DNS and the local dashboard independently, then load the temporary extension
again. It is expected not to be present automatically yet.

Normal Firefox requires a Mozilla-signed extension for permanent installation.
After testing, submit the Firefox extension for unlisted/self-distributed signing
on addons.mozilla.org, then install the signed XPI. Unlisted signing does not
publish it in the public add-ons catalogue. Review the obfuscated Netflix files
and Mozilla source-submission requirements before submitting; signing is not
guaranteed and this archive has not been signed. Do not disable signature checks
or weaken the localhost dashboard checks to work around this.

## Rollback

Remove Adblock (Firefox) in about:debugging or about:addons. The original Chrome
folder, DNS service, dashboard service and system DNS settings are untouched.
