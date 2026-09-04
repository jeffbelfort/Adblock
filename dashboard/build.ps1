# build.ps1
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

Write-Host ""
Write-Host "=== Building AdblockDashboard ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Downloading dependencies..." -ForegroundColor Yellow
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: go mod tidy failed" -ForegroundColor Red; pause; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host "Compiling..." -ForegroundColor Yellow
go build -o AdblockDashboard.exe .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Build failed" -ForegroundColor Red; pause; exit 1 }

Write-Host "  OK: AdblockDashboard.exe created" -ForegroundColor Green
Write-Host ""
Write-Host "Run install.ps1 as Administrator to install the service." -ForegroundColor Cyan
Write-Host ""
pause
