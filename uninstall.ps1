# Adblock - Uninstall Script
# Removes installed services/files and restores Windows DNS
# Run as Administrator

$ErrorActionPreference = "Stop"
$installRoot = Join-Path $env:ProgramFiles "Adblock"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Uninstaller" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    pause; exit 1
}

foreach ($name in @("AdblockDashboard", "AdblockDNS")) {
    Write-Host "Removing $name service..." -ForegroundColor Yellow
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -ne "Stopped") {
            sc.exe stop $name | Out-Null
            Start-Sleep -Seconds 1
        }
        sc.exe delete $name | Out-Null
        Write-Host "  OK" -ForegroundColor Green
    } else {
        Write-Host "  Already removed" -ForegroundColor DarkYellow
    }
}

if (Test-Path $installRoot) {
    Write-Host "Removing installed service files..." -ForegroundColor Yellow
    Remove-Item $installRoot -Recurse -Force
    Write-Host "  OK" -ForegroundColor Green
}

Write-Host "Restoring Windows DNS..." -ForegroundColor Yellow
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 2 /f | Out-Null
Start-Service -Name "Dnscache" -ErrorAction SilentlyContinue
Write-Host "  OK" -ForegroundColor Green

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
Write-Host "Your source tree and unpacked Chrome extension were not deleted." -ForegroundColor White
Write-Host ""
pause
