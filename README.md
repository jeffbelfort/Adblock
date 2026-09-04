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

## Install

1. Download and extract this folder anywhere on your machine
2. Right-click `install.ps1` and choose **Run as Administrator**
3. Follow the on-screen steps — it builds and installs everything automatically
4. When prompted, load the Chrome extension:
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `extension` folder

That's it. Both services start automatically on boot.

## Folder structure

```
Adblock/
├── dns/           Go service — DNS ad blocking on 127.0.0.1:53
├── dashboard/     Go service — control panel on localhost:9001
├── extension/     Chrome extension — browser-level blocking
├── install.ps1    One-click installer (run as Administrator)
└── uninstall.ps1  One-click uninstaller (run as Administrator)
```

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

Drop any `.txt` file into `dns/blocklists/` (one domain per line) then restart the DNS service via the dashboard or:

```powershell
cd dns
.\AdblockDNS.exe stop
.\AdblockDNS.exe start
```

## Uninstall

Right-click `uninstall.ps1` and choose **Run as Administrator**.
Then remove the Chrome extension at `chrome://extensions`.

## Dashboard

Open `http://localhost:9001` in Chrome to see:
- Blocks per hour graph
- Recently blocked domains
- Blocklist management
- DNS start/stop control
- History page with top blocked domains
