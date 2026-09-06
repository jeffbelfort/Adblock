# Adblock - Uninstall Script
# Removes all services and restores Windows DNS
# Run as Administrator

$ErrorActionPreference = "Stop"

$InstallRoot    = "$env:ProgramFiles\Adblock"
$DnsInstallDir  = Join-Path $InstallRoot "dns"
$DashInstallDir = Join-Path $InstallRoot "dashboard"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Uninstaller" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    pause; exit 1
}

# Services are removed by NAME via the Windows Service Control Manager,
# not by calling the installed exe. This works regardless of where the
# service happens to be registered (Program Files, an old Documents-folder
# install, etc), and even if that binary has since been moved or deleted.
function Remove-AdblockService([string]$name) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "  $name - not installed" -ForegroundColor Yellow
        return
    }
    if ($svc.Status -ne 'Stopped') {
        try { Stop-Service -Name $name -Force -ErrorAction Stop } catch {
            Write-Host "  Warning: could not stop $name cleanly: $_" -ForegroundColor Yellow
        }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
            $svc.Refresh()
            if ($svc.Status -eq 'Stopped') { break }
            Start-Sleep -Milliseconds 500
        }
    }
    $null = sc.exe delete $name
    Start-Sleep -Milliseconds 500
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
        Write-Host "  Could not fully remove $name - you may need to delete it manually (sc.exe delete $name)" -ForegroundColor Yellow
    } else {
        Write-Host "  OK" -ForegroundColor Green
    }
}

Write-Host "Removing DNS service..." -ForegroundColor Yellow
Remove-AdblockService "AdblockDNS"

Write-Host "Removing Dashboard service..." -ForegroundColor Yellow
Remove-AdblockService "AdblockDashboard"

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

# Remove the installed program files (binaries, config, blocklists, logs).
Write-Host "Removing installed files at $InstallRoot ..." -ForegroundColor Yellow
if (Test-Path $InstallRoot) {
    try {
        Remove-Item -Recurse -Force $InstallRoot
        Write-Host "  OK" -ForegroundColor Green
    } catch {
        Write-Host "  Could not fully remove $InstallRoot - you may need to delete it manually: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Nothing to remove" -ForegroundColor Yellow
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
