if (-not (Test-Path .venv)) {
    Write-Host "Virtual environment not found. Running setup_venv.ps1 first..." -ForegroundColor Yellow
    & .\setup_venv.ps1
}

& .\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "."
Write-Host "Starting Lead Research Dashboard on http://localhost:8012..." -ForegroundColor Green
python -m app.main
