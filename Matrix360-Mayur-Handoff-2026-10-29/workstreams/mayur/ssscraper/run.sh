#!/usr/bin/env bash
set -e

if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Running setup_venv.sh first..."
    ./setup_venv.sh
fi

source .venv/bin/activate
export PYTHONPATH="."
echo "Starting Lead Research Dashboard on http://localhost:${PORT:-8012}..."
exec python3 -m app.main
