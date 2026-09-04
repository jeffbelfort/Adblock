# uninstall.ps1 - Completely removes AdblockDNS and restores Windows DNS
# Run as Administrator

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== AdblockDNS Uninstaller ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator." -ForegroundColor Red
    pause
    exit 1
}

$exe = Join-Path $dir "AdblockDNS.exe"

# Stop and uninstall service
Write-Host "Stopping service..." -ForegroundColor Yellow
try { & $exe stop 2>$null } catch {}
Start-Sleep -Seconds 1

Write-Host "Uninstalling service..." -ForegroundColor Yellow
try {
    & $exe uninstall
    Write-Host "  OK" -ForegroundColor Green
} catch {
    Write-Host "  Service not found (already removed)" -ForegroundColor Yellow
}

# Re-enable Windows DNS cache
Write-Host "Restoring Windows DNS cache service..." -ForegroundColor Yellow
Set-Service -Name "Dnscache" -StartupType Automatic
Start-Service -Name "Dnscache"
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "Done. Remember to set your DNS back to Automatic in network settings." -ForegroundColor Cyan
Write-Host ""
pause
