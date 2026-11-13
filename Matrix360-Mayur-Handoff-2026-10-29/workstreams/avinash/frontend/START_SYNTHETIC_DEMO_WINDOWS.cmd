@echo off
cd /d "%~dp0"
echo MATRIX 360 LOCAL SYNTHETIC DEMO - NO REAL CUSTOMERS OR CAMPAIGNS
py -3 tools\run_synthetic_demo.py --synthetic-demo
pause
