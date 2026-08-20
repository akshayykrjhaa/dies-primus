# Repo City — one-command dev launcher (Windows / PowerShell).
#
#   .\start.ps1              start backend + frontend dev server
#   .\start.ps1 -Port 8020   use a different backend port
#   .\start.ps1 -BuildOnly   build the frontend and serve everything from the API
#
# The backend defaults to port 8010 because 8000 is often already taken.

param(
    [int]$Port = 8010,
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

Write-Host ''
Write-Host '  Repo City' -ForegroundColor Cyan
Write-Host '  ---------' -ForegroundColor DarkGray

# --- backend dependencies ------------------------------------------------
if (-not (Test-Path $python)) {
    Write-Host '  Creating the Python virtual environment...' -ForegroundColor DarkGray
    python -m venv (Join-Path $backend '.venv')
    & $python -m pip install --quiet --upgrade pip
    & $python -m pip install --quiet -r (Join-Path $backend 'requirements.txt')
}

# --- environment file ----------------------------------------------------
$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend '.env.example') $envFile
    Write-Host '  Created backend\.env — add your ANTHROPIC_API_KEY there.' -ForegroundColor Yellow
}
if (-not (Select-String -Path $envFile -Pattern '^ANTHROPIC_API_KEY=.+' -Quiet)) {
    Write-Host '  No ANTHROPIC_API_KEY yet: cities render, descriptions stay structural.' -ForegroundColor Yellow
}

# --- frontend dependencies ----------------------------------------------
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host '  Installing frontend packages...' -ForegroundColor DarkGray
    Push-Location $frontend
    npm install
    Pop-Location
}

if ($BuildOnly) {
    Write-Host '  Building the frontend...' -ForegroundColor DarkGray
    Push-Location $frontend
    npm run build
    Pop-Location
    Write-Host "  Open http://127.0.0.1:$Port" -ForegroundColor Green
    Push-Location $backend
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
    Pop-Location
    return
}

# --- run both, each in its own window ------------------------------------
Write-Host "  API      http://127.0.0.1:$Port  (docs at /docs)" -ForegroundColor Green
Write-Host '  App      http://localhost:5173' -ForegroundColor Green
Write-Host ''

Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$backend'; & '$python' -m uvicorn app.main:app --reload --host 127.0.0.1 --port $Port"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$frontend'; `$env:API_PORT = '$Port'; npm run dev"
)

Write-Host '  Two windows opened. Close them to stop the servers.' -ForegroundColor DarkGray
