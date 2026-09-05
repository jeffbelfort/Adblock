# uninstall.ps1 - Completely removes AdblockDNS and restores Windows DNS
# Run as Administrator

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:ProgramFiles "Adblock\dns"

Write-Host ""
Write-Host "=== AdblockDNS Uninstaller ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator." -ForegroundColor Red
    pause
    exit 1
}

Write-Host "Stopping/removing service..." -ForegroundColor Yellow
$service = Get-Service -Name "AdblockDNS" -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne "Stopped") {
        sc.exe stop AdblockDNS | Out-Null
        Start-Sleep -Seconds 1
    }
    sc.exe delete AdblockDNS | Out-Null
    Write-Host "  OK" -ForegroundColor Green
} else {
    Write-Host "  Service already removed" -ForegroundColor DarkYellow
}

if (Test-Path $installDir) {
    Remove-Item $installDir -Recurse -Force
}

Write-Host "Restoring Windows DNS cache service..." -ForegroundColor Yellow
Set-Service -Name "Dnscache" -StartupType Automatic
Start-Service -Name "Dnscache" -ErrorAction SilentlyContinue
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "Done. Remember to set your DNS back to Automatic if needed." -ForegroundColor Cyan
Write-Host ""
pause
