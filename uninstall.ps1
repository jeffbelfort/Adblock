# Adblock - Uninstall Script
# Removes all services and restores Windows DNS
# Run as Administrator

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Uninstaller" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    pause; exit 1
}

# Stop and remove DNS service
Write-Host "Removing DNS service..." -ForegroundColor Yellow
try { & "$root\dns\AdblockDNS.exe" stop 2>$null } catch {}
Start-Sleep -Seconds 1
try { & "$root\dns\AdblockDNS.exe" uninstall; Write-Host "  OK" -ForegroundColor Green } catch { Write-Host "  Already removed" -ForegroundColor Yellow }

# Stop and remove Dashboard service
Write-Host "Removing Dashboard service..." -ForegroundColor Yellow
try { & "$root\dashboard\AdblockDashboard.exe" stop 2>$null } catch {}
Start-Sleep -Seconds 1
try { & "$root\dashboard\AdblockDashboard.exe" uninstall; Write-Host "  OK" -ForegroundColor Green } catch { Write-Host "  Already removed" -ForegroundColor Yellow }

# Restore Windows DNS cache service
Write-Host "Restoring Windows DNS..." -ForegroundColor Yellow
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 2 /f | Out-Null
Start-Service -Name "Dnscache" -ErrorAction SilentlyContinue
Write-Host "  OK" -ForegroundColor Green

# Restore DNS to automatic on all adapters
Write-Host "Restoring network DNS settings..." -ForegroundColor Yellow
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" }
foreach ($adapter in $adapters) {
    try {
        Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ResetServerAddresses
        Write-Host "  OK - $($adapter.Name) reset to automatic" -ForegroundColor Green
    } catch {}
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Uninstall complete" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Don't forget to remove the Chrome extension:" -ForegroundColor Yellow
Write-Host "  chrome://extensions -> Adblock -> Remove" -ForegroundColor White
Write-Host ""
pause
