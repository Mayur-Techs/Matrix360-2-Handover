@echo off
if not exist .venv (
    echo Virtual environment not found. Running setup_venv.bat first...
    call setup_venv.bat
)

call .venv\Scripts\activate.bat
echo Starting Prompt-Driven Lead Research Dashboard on http://localhost:8012...
python -m app.main
pause
