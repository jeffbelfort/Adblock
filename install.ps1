# Adblock - Install Script
# Run this as Administrator to set everything up

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:ProgramFiles "Adblock"
$installDns = Join-Path $installRoot "dns"
$installDashboard = Join-Path $installRoot "dashboard"

function Write-JsonUtf8NoBom([object]$value, [string]$path) {
    $json = $value | ConvertTo-Json
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-IsAdmin {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]"Administrator"
    )
}

function Remove-ServiceIfPresent([string]$name) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $service) { return }

    if ($service.Status -ne "Stopped") {
        Write-Host "  Stopping $name..." -ForegroundColor DarkYellow
        sc.exe stop $name | Out-Null
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            $service = Get-Service -Name $name -ErrorAction SilentlyContinue
            if (-not $service -or $service.Status -eq "Stopped") { break }
        }
    }

    Write-Host "  Removing existing $name service..." -ForegroundColor DarkYellow
    sc.exe delete $name | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) { break }
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Custom Ad Blocker" -ForegroundColor Cyan
Write-Host "  Network-level + Browser extension" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-IsAdmin)) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    Write-Host "Right-click install.ps1 and choose 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Go is not installed." -ForegroundColor Red
    Write-Host "Download from https://go.dev/dl/ and install, then run this script again." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Go found: $(go version)" -ForegroundColor Green
Write-Host ""

# ── Step 1: Build DNS ─────────────────────────────────────────────────────────
Write-Host "[ 1/7 ] Building DNS service..." -ForegroundColor Yellow
Set-Location "$root\dns"
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red; pause; exit 1 }
go build -o AdblockDNS.exe .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS build failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

# ── Step 2: Build Dashboard ───────────────────────────────────────────────────
Write-Host "[ 2/7 ] Building Dashboard..." -ForegroundColor Yellow
Set-Location "$root\dashboard"
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red; pause; exit 1 }
go build -o AdblockDashboard.exe .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard build failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

# ── Step 3: Stop/remove old services ─────────────────────────────────────────
Write-Host "[ 3/7 ] Migrating existing services..." -ForegroundColor Yellow
Remove-ServiceIfPresent "AdblockDashboard"
Remove-ServiceIfPresent "AdblockDNS"
Write-Host "  OK" -ForegroundColor Green

# ── Step 4: Copy protected installed files ───────────────────────────────────
Write-Host "[ 4/7 ] Installing protected service files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $installDns | Out-Null
New-Item -ItemType Directory -Force -Path $installDashboard | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installDns "blocklists") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installDashboard "web") | Out-Null

# Preserve a custom blocklist created by the installed dashboard across upgrades.
$installedCustom = Join-Path $installDns "blocklists\custom.txt"
$customBackup = $null
if (Test-Path $installedCustom) {
    $customBackup = [System.IO.File]::ReadAllBytes($installedCustom)
}

Copy-Item "$root\dns\AdblockDNS.exe" (Join-Path $installDns "AdblockDNS.exe") -Force
Copy-Item "$root\dns\blocklists\*" (Join-Path $installDns "blocklists") -Force
if ($null -ne $customBackup) {
    [System.IO.File]::WriteAllBytes($installedCustom, $customBackup)
}

Copy-Item "$root\dashboard\AdblockDashboard.exe" (Join-Path $installDashboard "AdblockDashboard.exe") -Force
Copy-Item "$root\dashboard\web\*" (Join-Path $installDashboard "web") -Recurse -Force

# Installed configs deliberately reference only the protected installation tree.
$dnsConfig = [ordered]@{
    listen = "127.0.0.1:53"
    upstream = "1.1.1.1:53"
    blocklist_dir = (Join-Path $installDns "blocklists")
    cache_ttl = 300
}
$sourceDnsConfig = Join-Path $root "dns\config.json"
if (Test-Path $sourceDnsConfig) {
    try {
        $sourceCfg = Get-Content $sourceDnsConfig -Raw | ConvertFrom-Json
        if ($sourceCfg.listen) { $dnsConfig.listen = [string]$sourceCfg.listen }
        if ($sourceCfg.upstream) { $dnsConfig.upstream = [string]$sourceCfg.upstream }
        if ($sourceCfg.cache_ttl) { $dnsConfig.cache_ttl = [int]$sourceCfg.cache_ttl }
    } catch {
        Write-Host "  Warning: source DNS config could not be parsed; using safe defaults" -ForegroundColor Yellow
    }
}
Write-JsonUtf8NoBom $dnsConfig (Join-Path $installDns "config.json")

$dashboardConfig = [ordered]@{
    dns_dir = $installDns
}
Write-JsonUtf8NoBom $dashboardConfig (Join-Path $installDashboard "config.json")

Write-Host "  Installed to $installRoot" -ForegroundColor Green

# ── Step 5: Install/start DNS service ─────────────────────────────────────────
Write-Host "[ 5/7 ] Installing DNS service..." -ForegroundColor Yellow
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 4 /f | Out-Null
$dnsExe = Join-Path $installDns "AdblockDNS.exe"
& $dnsExe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS install failed" -ForegroundColor Red; pause; exit 1 }
& $dnsExe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: DNS start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK - DNS running on 127.0.0.1:53" -ForegroundColor Green

# ── Step 6: Install/start Dashboard service ───────────────────────────────────
Write-Host "[ 6/7 ] Installing Dashboard..." -ForegroundColor Yellow
$dashboardExe = Join-Path $installDashboard "AdblockDashboard.exe"
& $dashboardExe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard install failed" -ForegroundColor Red; pause; exit 1 }
& $dashboardExe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dashboard start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK - Dashboard running on http://localhost:9001" -ForegroundColor Green

# ── Step 7: Set DNS ───────────────────────────────────────────────────────────
Write-Host "[ 7/7 ] Configuring DNS..." -ForegroundColor Yellow
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
Write-Host "  Services:  $installRoot" -ForegroundColor White
Write-Host "  Dashboard: http://localhost:9001" -ForegroundColor White
Write-Host ""
Write-Host "  Chrome extension remains loaded from your source tree:" -ForegroundColor Yellow
Write-Host "  $root\extension" -ForegroundColor White
Write-Host ""
Write-Host "  Both services start automatically on boot." -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:9001"
pause
