#!/usr/bin/env bash
set -e

echo "========================================================"
echo " Setting up Python Virtual Environment (.venv)..."
echo "========================================================"

python3 -m venv .venv
source .venv/bin/activate

echo "Upgrading pip and installing requirements..."
pip install --upgrade pip
pip install -r requirements.txt

echo "Installing Playwright Chromium browser & OS dependencies..."
playwright install chromium
playwright install-deps chromium 2>/dev/null || true

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

echo "========================================================"
echo " Setup Complete! Run './run.sh' to start."
echo "========================================================"
