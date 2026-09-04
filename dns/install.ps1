# install.ps1 - Run this as Administrator to set up AdblockDNS
# Right-click install.ps1 -> Run with PowerShell (as Administrator)

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== AdblockDNS Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    Write-Host "Right-click install.ps1 and choose 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Check exe exists
$exe = Join-Path $dir "AdblockDNS.exe"
if (-not (Test-Path $exe)) {
    Write-Host "ERROR: AdblockDNS.exe not found in $dir" -ForegroundColor Red
    Write-Host "Make sure you built it first with build.ps1" -ForegroundColor Yellow
    pause
    exit 1
}

# Step 1: Free up port 53
Write-Host "Step 1: Freeing up port 53..." -ForegroundColor Yellow
try {
    Stop-Service -Name "Dnscache" -Force -ErrorAction SilentlyContinue
    Set-Service -Name "Dnscache" -StartupType Disabled
    Write-Host "  OK: Windows DNS cache service disabled" -ForegroundColor Green
} catch {
    Write-Host "  Warning: Could not disable Dnscache: $_" -ForegroundColor Yellow
}

# Step 2: Install the service
Write-Host "Step 2: Installing AdblockDNS service..." -ForegroundColor Yellow
try {
    & $exe uninstall 2>$null
} catch {}

& $exe install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install service" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "  OK: Service installed" -ForegroundColor Green

# Step 3: Start the service
Write-Host "Step 3: Starting service..." -ForegroundColor Yellow
& $exe start
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start service" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "  OK: Service started" -ForegroundColor Green

# Step 4: Test it
Write-Host "Step 4: Testing DNS..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
$result = Resolve-DnsName -Name "doubleclick.net" -Server "127.0.0.1" -ErrorAction SilentlyContinue
if ($result -and $result.IPAddress -contains "0.0.0.0") {
    Write-Host "  OK: Blocking is working (doubleclick.net -> 0.0.0.0)" -ForegroundColor Green
} else {
    Write-Host "  Warning: Could not verify blocking — service may still be starting" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now point your DNS to 127.0.0.1:" -ForegroundColor White
Write-Host "  Settings -> Network & Internet -> Advanced network settings"
Write-Host "  -> Your adapter -> Edit -> Manual -> IPv4"
Write-Host "  Preferred DNS:  127.0.0.1"
Write-Host "  Alternate DNS:  1.1.1.1"
Write-Host ""
Write-Host "The service starts automatically on boot. No Docker needed." -ForegroundColor Green
Write-Host ""
pause
