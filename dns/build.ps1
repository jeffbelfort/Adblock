# build.ps1 - Compiles AdblockDNS.exe
# Run this from the dns\ folder before installing

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== Building AdblockDNS ===" -ForegroundColor Cyan
Write-Host ""

Set-Location $dir

# Download dependencies
Write-Host "Downloading dependencies..." -ForegroundColor Yellow
go mod tidy
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "  OK" -ForegroundColor Green

# Build
Write-Host "Compiling..." -ForegroundColor Yellow
go build -o AdblockDNS.exe .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "  OK: AdblockDNS.exe created" -ForegroundColor Green
Write-Host ""
Write-Host "Now run install.ps1 as Administrator to install the service." -ForegroundColor Cyan
Write-Host ""
pause
