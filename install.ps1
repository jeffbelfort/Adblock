# Adblock - Install Script
# Run this as Administrator to set everything up
# Right-click -> Run with PowerShell

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Production install location. Services MUST run from here, not from the
# repo/checkout directory, since that directory is typically user-writable
# (Documents, Desktop, a git checkout, etc). A user-writable path behind a
# LocalSystem service is a local privilege-escalation vector: any
# unprivileged process could replace the exe and get SYSTEM on next start.
$InstallRoot    = "$env:ProgramFiles\Adblock"
$DnsInstallDir  = Join-Path $InstallRoot "dns"
$DashInstallDir = Join-Path $InstallRoot "dashboard"

# Track what we've done so we can roll back cleanly on failure instead of
# leaving a half-migrated service registration.
$script:RollbackActions = New-Object System.Collections.Generic.List[scriptblock]
function Add-Rollback([scriptblock]$action) { $script:RollbackActions.Insert(0, $action) }
function Invoke-Rollback {
    Write-Host ""
    Write-Host "Rolling back partial install..." -ForegroundColor Yellow
    foreach ($action in $script:RollbackActions) {
        try { & $action } catch { }
    }
    Write-Host "Rollback complete. No services should be left running." -ForegroundColor Yellow
}

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    Invoke-Rollback
    pause
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adblock - Custom Ad Blocker" -ForegroundColor Cyan
Write-Host "  Network-level + Browser extension" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    Write-Host "Right-click install.ps1 and choose 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Check Go is installed
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Go is not installed." -ForegroundColor Red
    Write-Host "Download from https://go.dev/dl/ and install, then run this script again." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Go found: $(go version)" -ForegroundColor Green
Write-Host ""

# ── Step 1: Migrate/remove any pre-existing service registration ──────────
# Services are registered in Windows by NAME (AdblockDNS / AdblockDashboard),
# independent of where the binary lives. This means we can find and remove
# an older install regardless of whether it points at Program Files, a repo
# checkout under Documents, or anywhere else - and it works even if that old
# binary has since been moved or deleted, since sc.exe only needs the
# service name to unregister it.
Write-Host "[ 1/7 ] Checking for existing service registrations..." -ForegroundColor Yellow

function Remove-AdblockService([string]$name) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "  $name - not currently installed" -ForegroundColor DarkGray
        return
    }

    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
    $imagePath = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ImagePath
    if ($imagePath) {
        Write-Host "  Found $name registered at: $imagePath" -ForegroundColor Yellow
        if ($imagePath -notlike "*$InstallRoot*") {
            Write-Host "    (this is an older install location - migrating)" -ForegroundColor Yellow
        }
    }

    if ($svc.Status -ne 'Stopped') {
        try { Stop-Service -Name $name -Force -ErrorAction Stop } catch {
            Write-Host "  Warning: could not stop $name cleanly: $_" -ForegroundColor Yellow
        }
        # Give the SCM a moment to actually settle to Stopped before deleting.
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
        Fail "Could not remove existing '$name' service registration. Close any open handles (dashboard, services.msc) and re-run."
    }
    Write-Host "  $name - removed" -ForegroundColor Green
}

Remove-AdblockService "AdblockDNS"
Remove-AdblockService "AdblockDashboard"

# ── Step 2: Build DNS ─────────────────────────────────────────────────────
Write-Host "[ 2/7 ] Building DNS service..." -ForegroundColor Yellow
Set-Location "$root\dns"
go mod tidy
if ($LASTEXITCODE -ne 0) { Fail "go mod tidy failed (dns)" }
go build -o AdblockDNS.exe .
if ($LASTEXITCODE -ne 0) { Fail "DNS build failed" }
Write-Host "  OK" -ForegroundColor Green

# ── Step 3: Build Dashboard ────────────────────────────────────────────────
Write-Host "[ 3/7 ] Building Dashboard..." -ForegroundColor Yellow
Set-Location "$root\dashboard"
go mod tidy
if ($LASTEXITCODE -ne 0) { Fail "go mod tidy failed (dashboard)" }
go build -o AdblockDashboard.exe .
if ($LASTEXITCODE -ne 0) { Fail "Dashboard build failed" }
Write-Host "  OK" -ForegroundColor Green

# ── Step 4: Copy into protected Program Files location ────────────────────
Write-Host "[ 4/7 ] Installing to $InstallRoot ..." -ForegroundColor Yellow

New-Item -ItemType Directory -Force -Path $DnsInstallDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DashInstallDir | Out-Null
Add-Rollback { Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue }

# Program Files inherits admin-only write ACLs by default. We still set them
# explicitly rather than assume the default, since some machines have been
# manually reconfigured or the folder pre-exists with looser permissions
# from an older install.
function Lock-ToAdmins([string]$path) {
    $acl = Get-Acl $path
    $acl.SetAccessRuleProtection($true, $false)  # disable inheritance, drop inherited rules
    $admins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544") # Administrators
    $system = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")     # SYSTEM
    $users  = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-11")     # Authenticated Users

    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $admins, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $system, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")))
    # Ordinary users can run the services but not modify/replace the binaries.
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $users, "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow")))

    Set-Acl -Path $path -AclObject $acl
}
Lock-ToAdmins $InstallRoot

Copy-Item "$root\dns\AdblockDNS.exe"        "$DnsInstallDir\AdblockDNS.exe"        -Force
Copy-Item "$root\dns\config.json"           "$DnsInstallDir\config.json"           -Force -ErrorAction SilentlyContinue
Copy-Item "$root\dns\blocklists"            "$DnsInstallDir\blocklists"            -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item "$root\dashboard\AdblockDashboard.exe" "$DashInstallDir\AdblockDashboard.exe" -Force
Copy-Item "$root\dashboard\config.json"          "$DashInstallDir\config.json"          -Force -ErrorAction SilentlyContinue
Copy-Item "$root\dashboard\web"                  "$DashInstallDir\web"                  -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "  OK - binaries installed under admin-only path" -ForegroundColor Green

# ── Step 5: Install DNS service (from Program Files, not the repo) ────────
Write-Host "[ 5/7 ] Installing DNS service..." -ForegroundColor Yellow
Set-Location $DnsInstallDir

# Free up port 53 via registry
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 4 /f | Out-Null
Add-Rollback { reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 2 /f | Out-Null }

.\AdblockDNS.exe install
if ($LASTEXITCODE -ne 0) { Fail "DNS service install failed" }
Add-Rollback { try { & "$DnsInstallDir\AdblockDNS.exe" stop 2>$null } catch {}; try { & "$DnsInstallDir\AdblockDNS.exe" uninstall 2>$null } catch {} }

.\AdblockDNS.exe start
if ($LASTEXITCODE -ne 0) { Fail "DNS service start failed" }
Write-Host "  OK - DNS running on 127.0.0.1:53" -ForegroundColor Green

# ── Step 6: Install Dashboard service ──────────────────────────────────────
Write-Host "[ 6/7 ] Installing Dashboard service..." -ForegroundColor Yellow
Set-Location $DashInstallDir

.\AdblockDashboard.exe install
if ($LASTEXITCODE -ne 0) { Fail "Dashboard service install failed" }
Add-Rollback { try { & "$DashInstallDir\AdblockDashboard.exe" stop 2>$null } catch {}; try { & "$DashInstallDir\AdblockDashboard.exe" uninstall 2>$null } catch {} }

.\AdblockDashboard.exe start
if ($LASTEXITCODE -ne 0) { Fail "Dashboard service start failed" }
Write-Host "  OK - Dashboard running on http://localhost:9001" -ForegroundColor Green

# ── Step 7: Set DNS + verify resolution actually works ─────────────────────
Write-Host "[ 7/7 ] Configuring and verifying DNS..." -ForegroundColor Yellow

# Sanity check BEFORE repointing every adapter at 127.0.0.1: if the local
# resolver can't actually resolve anything, switching all adapters to it
# would silently break all network access on the machine.
Start-Sleep -Seconds 1
$healthy = $false
for ($i = 0; $i -lt 5; $i++) {
    try {
        $result = Resolve-DnsName -Name "example.com" -Server 127.0.0.1 -ErrorAction Stop
        if ($result) { $healthy = $true; break }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $healthy) {
    Fail "Local DNS resolver is not answering queries - refusing to repoint network adapters. Check dns\AdblockDNS.exe logs."
}
Write-Host "  OK - local resolver verified healthy" -ForegroundColor Green

$adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notlike "*Loopback*" -and $_.InterfaceDescription -notlike "*WireGuard*" }
foreach ($adapter in $adapters) {
    try {
        Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses "127.0.0.1"
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
Write-Host "  Installed to: $InstallRoot" -ForegroundColor White
Write-Host "  Dashboard:    http://localhost:9001" -ForegroundColor White
Write-Host ""
Write-Host "  One more step - load the Chrome extension:" -ForegroundColor Yellow
Write-Host "  1. Open Chrome and go to chrome://extensions" -ForegroundColor White
Write-Host "  2. Enable Developer mode (top right toggle)" -ForegroundColor White
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
Write-Host "  4. Select the 'extension' folder inside the Adblock checkout" -ForegroundColor White
Write-Host ""
Write-Host "  Both services start automatically on boot." -ForegroundColor Green
Write-Host "  No Docker, no dependencies, nothing to keep open." -ForegroundColor Green
Write-Host ""

# Open dashboard and Chrome extensions page
Start-Process "http://localhost:9001"
Start-Sleep -Seconds 2
Start-Process "chrome" "chrome://extensions" -ErrorAction SilentlyContinue

pause
