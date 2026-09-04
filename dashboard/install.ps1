# install.ps1 - Run as Administrator
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir "AdblockDashboard.exe"

Write-Host ""
Write-Host "=== AdblockDashboard Installer ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Run as Administrator" -ForegroundColor Red
    pause; exit 1
}

if (-not (Test-Path $exe)) {
    Write-Host "ERROR: AdblockDashboard.exe not found - run build.ps1 first" -ForegroundColor Red
    pause; exit 1
}

try { & $exe uninstall 2>$null } catch {}

Write-Host "Installing service..." -ForegroundColor Yellow
& $exe install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Install failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host "Starting service..." -ForegroundColor Yellow
& $exe start
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Start failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Open your dashboard at: http://localhost:9001" -ForegroundColor Green
Write-Host ""
pause
