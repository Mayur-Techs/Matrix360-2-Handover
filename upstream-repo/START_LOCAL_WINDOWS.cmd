@echo off
cd /d "%~dp0"
set "PORT=8050"
node tools/local-preview.cjs
pause
