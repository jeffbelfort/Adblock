# install.ps1 - Run as Administrator
# Builds/copies AdblockDNS into a protected Program Files location and installs it as a service.

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:ProgramFiles "Adblock\dns"
$installBlocklists = Join-Path $installDir "blocklists"

Write-Host ""
Write-Host "=== AdblockDNS Installer ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    pause
    exit 1
}

$sourceExe = Join-Path $dir "AdblockDNS.exe"
if (-not (Test-Path $sourceExe)) {
    Write-Host "ERROR: AdblockDNS.exe not found in $dir" -ForegroundColor Red
    Write-Host "Build it first with build.ps1" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Step 1: Freeing up port 53..." -ForegroundColor Yellow
try {
    Stop-Service -Name "Dnscache" -Force -ErrorAction SilentlyContinue
    Set-Service -Name "Dnscache" -StartupType Disabled
    Write-Host "  OK: Windows DNS cache service disabled" -ForegroundColor Green
} catch {
    Write-Host "  Warning: Could not disable Dnscache: $_" -ForegroundColor Yellow
}

Write-Host "Step 2: Removing existing service..." -ForegroundColor Yellow
$service = Get-Service -Name "AdblockDNS" -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne "Stopped") {
        sc.exe stop AdblockDNS | Out-Null
        Start-Sleep -Seconds 1
    }
    sc.exe delete AdblockDNS | Out-Null
    Start-Sleep -Seconds 1
}
Write-Host "  OK" -ForegroundColor Green

Write-Host "Step 3: Copying protected service files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $installBlocklists | Out-Null
$installedCustom = Join-Path $installBlocklists "custom.txt"
$customBackup = $null
if (Test-Path $installedCustom) {
    $customBackup = [System.IO.File]::ReadAllBytes($installedCustom)
}
Copy-Item $sourceExe (Join-Path $installDir "AdblockDNS.exe") -Force
Copy-Item "$dir\blocklists\*" $installBlocklists -Force
if ($null -ne $customBackup) {
    [System.IO.File]::WriteAllBytes($installedCustom, $customBackup)
}

$cfg = [ordered]@{
    listen = "127.0.0.1:53"
    upstream = "1.1.1.1:53"
    blocklist_dir = $installBlocklists
    cache_ttl = 300
}
$sourceConfig = Join-Path $dir "config.json"
if (Test-Path $sourceConfig) {
    try {
        $sourceCfg = Get-Content $sourceConfig -Raw | ConvertFrom-Json
        if ($sourceCfg.listen) { $cfg.listen = [string]$sourceCfg.listen }
        if ($sourceCfg.upstream) { $cfg.upstream = [string]$sourceCfg.upstream }
        if ($sourceCfg.cache_ttl) { $cfg.cache_ttl = [int]$sourceCfg.cache_ttl }
    } catch {
        Write-Host "  Warning: source DNS config could not be parsed; using safe defaults" -ForegroundColor Yellow
    }
}
$json = $cfg | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $installDir "config.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  OK: $installDir" -ForegroundColor Green

Write-Host "Step 4: Installing service..." -ForegroundColor Yellow
$exe = Join-Path $installDir "AdblockDNS.exe"
& $exe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Failed to install service" -ForegroundColor Red; pause; exit 1 }
& $exe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Failed to start service" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK: Service started" -ForegroundColor Green

Write-Host "Step 5: Testing DNS..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
$result = Resolve-DnsName -Name "doubleclick.net" -Server "127.0.0.1" -ErrorAction SilentlyContinue
if ($result -and $result.IPAddress -contains "0.0.0.0") {
    Write-Host "  OK: Blocking is working (doubleclick.net -> 0.0.0.0)" -ForegroundColor Green
} else {
    Write-Host "  Warning: Could not verify blocking - service may still be starting" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "Installed service binary: $exe" -ForegroundColor Green
Write-Host ""
pause
