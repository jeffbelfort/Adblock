# Adblock

A self-contained, custom ad blocker. No third-party services. No subscriptions. Runs entirely on your machine.

## What it does

- **DNS layer** — blocks 82,000+ ad/tracker domains system-wide before any connection is made
- **Chrome extension** — blocks ads on YouTube, ITVX, Channel 4, SoundCloud, news sites, and more
- **Dashboard** — control panel at `http://localhost:9001` to monitor blocks, manage lists, start/stop DNS

## Requirements

- Windows 10 or 11
- [Go](https://go.dev/dl/) installed (`go1.21+`)
- Google Chrome
- Administrator rights (the installer registers Windows services and writes to `Program Files`)

## Install

1. Download and extract this folder anywhere on your machine
2. Right-click `install.ps1` and choose **Run as Administrator**
3. Follow the on-screen steps — it builds everything from this folder, then installs the compiled
   services into `C:\Program Files\Adblock\` (not this folder) so the running binaries live in a
   location ordinary user processes can't modify
4. When prompted, load the Chrome extension:
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `extension` folder **inside this checkout** (the extension is loaded from source,
     not from the `Program Files` copy)

That's it. Both services start automatically on boot.

### Re-running the installer

`install.ps1` is safe to run again after pulling updates or making source changes. It detects any
existing `AdblockDNS`/`AdblockDashboard` service — wherever it's currently registered, including
older installs that predate the `Program Files` migration — cleanly removes it, rebuilds from the
current source, and reinstalls. If anything fails partway through, it rolls back the steps it had
already taken rather than leaving a half-migrated install.

## Folder structure

```
Adblock/
├── dns/           Go service source — builds AdblockDNS.exe
├── dashboard/     Go service source — builds AdblockDashboard.exe
├── extension/     Chrome extension — loaded from here directly (browser-level blocking)
├── install.ps1    One-click installer (run as Administrator)
└── uninstall.ps1  One-click uninstaller (run as Administrator)
```

The compiled services themselves run from `C:\Program Files\Adblock\dns\` and
`C:\Program Files\Adblock\dashboard\` after install — not from this folder. This folder is the
source checkout; `Program Files` is where things actually execute from.

## What gets blocked

| Target | Method |
|--------|--------|
| General web ads | DNS + extension |
| Trackers and telemetry | DNS |
| YouTube ads (browser) | Extension — cosmetic + skip |
| ITVX pre-roll ads | Extension — skip via ended event |
| Channel 4 ads | Extension |
| SoundCloud ads | Extension — DAX network blocked |
| News site ads | DNS + extension cosmetic filtering |
| Adult ad networks | DNS |

## What doesn't get blocked

- Netflix, Disney+, Prime Video — subscription services, no ads
- Steam — no ads
- Spotify (paid) — no ads
- YouTube app — certificate pinning prevents interception

## Adding blocked domains

Drop any `.txt` file into `dns/blocklists/` in this checkout (one domain per line), then either:

- Restart the DNS service from the dashboard (`http://localhost:9001`), **or**
- Restart it directly, from an elevated PowerShell prompt:

  ```powershell
  Restart-Service AdblockDNS
  ```

Note: the installer copies `blocklists/` into `Program Files` at install time. After adding a new
list file here, re-run `install.ps1` (or manually copy the file into
`C:\Program Files\Adblock\dns\blocklists\`) so the running service actually picks it up.

## Uninstall

Right-click `uninstall.ps1` and choose **Run as Administrator**. This stops and removes both
services and deletes the installed copy under `C:\Program Files\Adblock\`.
Then remove the Chrome extension at `chrome://extensions`.

## Dashboard

Open `http://localhost:9001` in Chrome to see:
- Blocks per hour graph
- Recently blocked domains
- Blocklist management
- DNS start/stop control
- History page with top blocked domains

### Security notes

The dashboard binds to `127.0.0.1` only. State-changing requests (blocklist edits, service
start/stop) require a locally-generated API token and validate the request's Host/Origin — this
prevents a malicious website open in the browser from silently controlling the DNS service or
blocklist through the dashboard's API. Read-only status endpoints don't require the token.

The custom blocklist API validates submitted domains (size limits, strict JSON parsing, hostname
format) before writing to `custom.txt`, to prevent malformed or malicious input from corrupting the
blocklist file.
