# Adblock

A local ad-blocking project combining a system-wide DNS blocker, browser extensions, and a Go dashboard. Supports Windows and Linux, with separate Chrome and Firefox extension folders.

## Components

| Component | Purpose |
| --- | --- |
| DNS service | Filters domain lookups against local blocklists and forwards allowed queries to an upstream resolver. |
| Browser extension | Adds request filtering, cosmetic element hiding, custom filters, site exceptions, and site-specific scripts. |
| Local dashboard | Displays DNS activity and blocklists, and controls the DNS service at `http://localhost:9001`. |

The DNS layer applies to applications using your configured system resolver. The extension adds browser-level filtering; the two layers have separate settings and counters.

This is a source project. Cloning it does not install services or configure your system DNS. Filter subscriptions and allowed DNS queries make network requests to their configured providers; the default upstream is Cloudflare (`1.1.1.1:53`).

## Requirements and status

- Go 1.21 or newer to build the DNS service and dashboard.
- Windows 10/11 for the PowerShell installer, or Linux with systemd for the supplied service templates.
- Administrator privileges for Windows installation; sudo privileges for Linux service installation and DNS configuration.
- Chrome for `extension/`, or Firefox 142+ for `extension-firefox/`.

The Linux port has been exercised on Linux Mint 22.3: DNS blocking and dashboard access work, and the Firefox extension loads and imports filter lists. Streaming integrations, extension block counters, restart behaviour, and Windows regression testing are not all independently verified. Treat these as development builds rather than a guarantee of compatibility with every site.

## Windows installation

1. Download the source or clone this repository.
2. Open PowerShell as Administrator in the project directory and run:

   ```powershell
   .\install.ps1
   ```

3. Follow the installer prompts. It builds the Go programs and installs the `AdblockDNS` and `AdblockDashboard` services under `C:\Program Files\Adblock\`.
4. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` folder.
5. Open `http://localhost:9001` to inspect DNS status and activity.

The Chrome extension runs from the source folder you selected. Keep that folder available. The Windows services run from the installed copy under `Program Files`.

Re-run the installer to deploy source updates or changed blocklist files to the installed copy. The installer includes existing-service removal and rollback handling; review any errors rather than assuming an interrupted installation succeeded.

To uninstall, run `uninstall.ps1` from an elevated PowerShell session and remove the extension in Chrome. Verify your network's DNS settings afterwards.

## Linux installation

Linux currently uses a manual source installation. There is no Linux one-click installer in this repository.

### Build

From the repository root:

```bash
(cd dns && go build -o adblock-dns .)
(cd dashboard && go build -o adblock-dashboard .)
cp dashboard/config.example.json dashboard/config.json
```

Edit `dashboard/config.json` so `dns_dir` is the absolute path to this checkout's `dns` directory. This file is ignored by Git because paths differ between machines. The dashboard also has a sibling-directory fallback when no config is supplied.

Keep the built programs beside their assets: `dns/config.json` and `dns/blocklists/` for DNS, and `dashboard/web/` for the dashboard. Do not move the binaries on their own.

### Install systemd services

Templates are in `packaging/linux/`. In copies of both `.service.in` files, replace:

- `@USER@` with the Linux account that will run the services.
- `@PROJECT_DIR@` with the absolute checkout path.

Install the resulting files as:

```text
/etc/systemd/system/adblock-dns.service
/etc/systemd/system/adblock-dashboard.service
```

Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now adblock-dns.service adblock-dashboard.service
systemctl status adblock-dns.service adblock-dashboard.service --no-pager
```

The DNS template grants `CAP_NET_BIND_SERVICE` so the service can bind port 53 while running as the selected user. It binds to loopback by default, not your LAN address. Check for an existing listener before starting it:

```bash
sudo ss -lntup 'sport = :53'
```

A service bound to `127.0.0.53` is a different listener from the project's default `127.0.0.1`; a wildcard listener may conflict. Do not disable your existing resolver without checking your setup.

### Dashboard service controls

On Linux, the dashboard invokes `sudo -n /usr/bin/systemctl` to start or stop `adblock-dns.service`. Reading dashboard statistics does not require this permission.

If you want those buttons enabled, use `sudo visudo -f /etc/sudoers.d/adblock-dashboard` and add an account-specific rule, replacing `YOUR_USER`:

```sudoers
YOUR_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start adblock-dns.service, /usr/bin/systemctl stop adblock-dns.service
```

Check the executable paths on your distribution. Grant only the two exact commands, rather than unrestricted sudo access. The dashboard unit intentionally does not set `NoNewPrivileges`, because that would prevent this sudo-based control path.

### Test before changing system DNS

```bash
dig @127.0.0.1 example.com
dig @127.0.0.1 doubleclick.net
```

With the included list enabled, a blocked A query should return `0.0.0.0`; an allowed query should return a normal answer. You can test a different domain from your own blocklists if those lists change.

Only after direct queries work, configure your active network connection to use `127.0.0.1` as its DNS server. With NetworkManager, set the profile's DNS manually and disable automatic DNS for IPv4 and IPv6 to avoid provider DNS bypassing the blocker. Record the original settings first. Browser DNS-over-HTTPS or application-specific DNS may bypass system DNS too.

**Stopping the blocker does not restore your previous DNS settings.** Restore the original resolver settings before disabling or uninstalling the service, or fresh name lookups may fail. A public fallback resolver can also bypass blocking.

To rebuild after source changes, stop the relevant service, build its binary, then start it again. Account for the DNS dependency before stopping DNS.

## Firefox extension

For development:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `extension-firefox/manifest.json`.
4. Grant website permissions if prompted, then reload existing website tabs.

Temporary installations disappear when Firefox closes. A permanent installation in normal Firefox requires a Mozilla-signed `.xpi`. Signing submission is separate from this source checkout; this README does not imply that a signed release is available. Each updated permanent release needs signing again.

For a signing upload with `manifest.json` at the archive root, run from the repository root:

```bash
git archive --format=zip --output=adblock-firefox-signing.zip HEAD:extension-firefox
```

This packages committed files only. Commit intended extension changes before generating the archive. Never include credentials or signing API keys.

Chrome and Firefox do not share extension storage. Add filter subscriptions, custom filters and site exceptions in the browser you use. The DNS blocklists remain separate.

## Configuration and blocklists

The default `dns/config.json` is:

```json
{
  "listen": "127.0.0.1:53",
  "upstream": "1.1.1.1:53",
  "blocklist_dir": "blocklists",
  "cache_ttl": 300
}
```

Put domain lists in `dns/blocklists/`. A simple custom list contains one domain per line. Restart the DNS service to reload lists:

```bash
sudo systemctl restart adblock-dns.service
```

On Windows, update the installed blocklists under `C:\Program Files\Adblock\dns\blocklists\` and restart `AdblockDNS`, or re-run the installer to deploy checkout changes.

Browser filter subscriptions are managed in the extension dashboard. The parser supports a subset of filter syntax; importing uBlock lists does not reproduce the full uBlock Origin engine. Browser dynamic-rule quotas limit how many network rules can be installed.

## Behaviour and limitations

- A browser site exception or protection toggle does not override a DNS block.
- Browser block counters do not measure all system-wide DNS blocking. Use the DNS request log to inspect DNS activity.
- DNS can block domains, not individual URL paths or elements on a page. Blocking a shared domain can affect wanted content.
- Site-specific YouTube, ITVX and Netflix scripts are included. Site changes can break them; their presence is not proof that current playback or filtering works.
- The Netflix scripts modify selected interstitial interactions and are intended to address household prompts. Firefox playback has not been verified in this port; this is not a VPN or a change to your public IP address.
- Browser extensions do not provide equivalent filtering inside unrelated native applications.
- An unavailable DNS panel in the extension does not necessarily mean the DNS service is down. Use `http://localhost:9001` directly; its API deliberately validates request origins.

## Security and local data

The Go dashboard binds to `127.0.0.1:9001`. It validates Host/Origin and requires a generated token for state-changing API requests. Do not remove those checks or expose it publicly to make an extension integration work.

The DNS service records blocked domains in `dns/adblock-dns.log`. These logs may reveal browsing activity. Logs, Linux binaries, local dashboard configuration and backup files are excluded from new commits; exclusion does not remove files already present in older Git history.

The Linux service templates are a development setup running from a checkout. Choose deployment paths and filesystem permissions appropriate to your environment. They are not a complete production packaging or hardening solution.

## Repository layout

| Path | Contents |
| --- | --- |
| `dns/` | Shared DNS code, Linux entry point, Windows service implementation, configuration and blocklists. |
| `dashboard/` | Go dashboard, web assets and example local configuration. |
| `extension/` | Chrome extension. |
| `extension-firefox/` | Firefox extension. |
| `packaging/linux/` | systemd service templates. |
| `install.ps1`, `uninstall.ps1` | Windows installation/removal scripts. |

Go selects platform-specific files using the `_windows.go` and `_linux.go` filename suffixes. Both platforms share the same source repository; separate Windows/Linux release downloads can be built from it.
