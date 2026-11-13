@echo off
echo ========================================================
echo  Setting up Python Virtual Environment (.venv)...
echo ========================================================

python -m venv .venv
if errorlevel 1 (
    echo [ERROR] Failed to create .venv. Please ensure Python 3.10+ is installed and in PATH.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
echo Installing dependencies from requirements.txt...
python -m pip install --upgrade pip
pip install -r requirements.txt

echo Installing Playwright Chromium browser...
playwright install chromium

if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo [NOTE] Remember to add your API keys to .env
)

echo ========================================================
echo  Setup Complete! Run 'run.bat' to start the application.
echo ========================================================
