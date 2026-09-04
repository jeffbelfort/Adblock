# Adblock - Install Script
# Run this as Administrator to set everything up
# Right-click -> Run with PowerShell

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Custom Ad Blocker" -ForegroundColor Cyan
Write-Host "  Network-level + Browser extension" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    Write-Host "Right-click install.ps1 and choose 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Check Go is installed
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Go is not installed." -ForegroundColor Red
    Write-Host "Download from https://go.dev/dl/ and install, then run this script again." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Go found: $(go version)" -ForegroundColor Green
Write-Host ""

# ── Step 1: Build DNS ─────────────────────────────────────────────────────────
Write-Host "[ 1/5 ] Building DNS service..." -ForegroundColor Yellow
Set-Location "$root\dns"
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red; pause; exit 1 }
go build -o AdblockDNS.exe .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS build failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

# ── Step 2: Build Dashboard ───────────────────────────────────────────────────
Write-Host "[ 2/5 ] Building Dashboard..." -ForegroundColor Yellow
Set-Location "$root\dashboard"
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red; pause; exit 1 }
go build -o AdblockDashboard.exe .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard build failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

# ── Step 3: Install DNS service ───────────────────────────────────────────────
Write-Host "[ 3/5 ] Installing DNS service..." -ForegroundColor Yellow
Set-Location "$root\dns"

# Free up port 53 via registry
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 4 /f | Out-Null

# Remove existing service if present
try { .\AdblockDNS.exe stop 2>$null } catch {}
try { .\AdblockDNS.exe uninstall 2>$null } catch {}

.\AdblockDNS.exe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS install failed" -ForegroundColor Red; pause; exit 1 }
.\AdblockDNS.exe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK - DNS running on 127.0.0.1:53" -ForegroundColor Green

# ── Step 4: Install Dashboard service ────────────────────────────────────────
Write-Host "[ 4/5 ] Installing Dashboard..." -ForegroundColor Yellow
Set-Location "$root\dashboard"

try { .\AdblockDashboard.exe stop 2>$null } catch {}
try { .\AdblockDashboard.exe uninstall 2>$null } catch {}

.\AdblockDashboard.exe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard install failed" -ForegroundColor Red; pause; exit 1 }
.\AdblockDashboard.exe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK - Dashboard running on http://localhost:9001" -ForegroundColor Green

# ── Step 5: Set DNS ───────────────────────────────────────────────────────────
Write-Host "[ 5/5 ] Configuring DNS..." -ForegroundColor Yellow
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notlike "*Loopback*" -and $_.InterfaceDescription -notlike "*WireGuard*" }
foreach ($adapter in $adapters) {
    try {
        Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses ("127.0.0.1", "1.1.1.1")
        Write-Host "  OK - DNS set on $($adapter.Name)" -ForegroundColor Green
    } catch {
        Write-Host "  Skipped $($adapter.Name): $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dashboard: http://localhost:9001" -ForegroundColor White
Write-Host ""
Write-Host "  One more step - load the Chrome extension:" -ForegroundColor Yellow
Write-Host "  1. Open Chrome and go to chrome://extensions" -ForegroundColor White
Write-Host "  2. Enable Developer mode (top right toggle)" -ForegroundColor White
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
Write-Host "  4. Select the 'extension' folder inside Adblock" -ForegroundColor White
Write-Host ""
Write-Host "  Both services start automatically on boot." -ForegroundColor Green
Write-Host "  No Docker, no dependencies, nothing to keep open." -ForegroundColor Green
Write-Host ""

# Open dashboard and Chrome extensions page
Start-Process "http://localhost:9001"
Start-Sleep -Seconds 2
Start-Process "chrome" "chrome://extensions" -ErrorAction SilentlyContinue

pause
