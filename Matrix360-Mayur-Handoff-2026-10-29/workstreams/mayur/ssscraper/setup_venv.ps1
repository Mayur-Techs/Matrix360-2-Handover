Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Setting up Python Virtual Environment (.venv)..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

python -m venv .venv
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to create .venv. Check your Python installation." -ForegroundColor Red
    exit 1
}

& .\.venv\Scripts\Activate.ps1
Write-Host "Upgrading pip and installing requirements..." -ForegroundColor Green
python -m pip install --upgrade pip
pip install -r requirements.txt

Write-Host "Installing Playwright Chromium browser..." -ForegroundColor Green
playwright install chromium

if (-not (Test-Path .env)) {
    Write-Host "Creating .env from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Setup Complete! Run '.\run.ps1' to start the application." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
