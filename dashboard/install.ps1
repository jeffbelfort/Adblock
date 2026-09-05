# install.ps1 - Run as Administrator
# Copies AdblockDashboard into a protected Program Files location and installs it as a service.

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:ProgramFiles "Adblock\dashboard"
$dnsInstallDir = Join-Path $env:ProgramFiles "Adblock\dns"

Write-Host ""
Write-Host "=== AdblockDashboard Installer ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Run as Administrator" -ForegroundColor Red
    pause; exit 1
}

$sourceExe = Join-Path $dir "AdblockDashboard.exe"
if (-not (Test-Path $sourceExe)) {
    Write-Host "ERROR: AdblockDashboard.exe not found - run build.ps1 first" -ForegroundColor Red
    pause; exit 1
}
if (-not (Test-Path (Join-Path $dnsInstallDir "AdblockDNS.exe"))) {
    Write-Host "ERROR: Protected DNS installation not found at $dnsInstallDir" -ForegroundColor Red
    Write-Host "Install DNS first, or use the root install.ps1." -ForegroundColor Yellow
    pause; exit 1
}

$service = Get-Service -Name "AdblockDashboard" -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne "Stopped") {
        sc.exe stop AdblockDashboard | Out-Null
        Start-Sleep -Seconds 1
    }
    sc.exe delete AdblockDashboard | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "Copying protected service files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path (Join-Path $installDir "web") | Out-Null
Copy-Item $sourceExe (Join-Path $installDir "AdblockDashboard.exe") -Force
Copy-Item "$dir\web\*" (Join-Path $installDir "web") -Recurse -Force
$json = @{ dns_dir = $dnsInstallDir } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $installDir "config.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  OK: $installDir" -ForegroundColor Green

$exe = Join-Path $installDir "AdblockDashboard.exe"
Write-Host "Installing service..." -ForegroundColor Yellow
& $exe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Install failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "Starting service..." -ForegroundColor Yellow
& $exe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "Open your dashboard at: http://localhost:9001" -ForegroundColor Green
Write-Host ""
pause
