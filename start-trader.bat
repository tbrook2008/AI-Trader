@echo off
:: ============================================================
::  AI TRADER — Background Launcher
::  Double-click start-trader.vbs instead (runs this silently)
::  This file does the actual work
:: ============================================================

cd /d "c:\Users\tbroo\Desktop\AI TRADER\AI-Trader"

:: ── Step 1: Start Ollama if not already running ─────────────
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I "ollama.exe" >NUL 2>&1
if ERRORLEVEL 1 (
    echo Starting Ollama...
    start "" /B ollama serve
    :: Give Ollama 5 seconds to load the model
    timeout /t 5 /nobreak >NUL
) else (
    echo Ollama already running.
)

:: ── Step 2: Start API server (port 3000) ────────────────────
pm2 describe ai-trader-api >NUL 2>&1
if ERRORLEVEL 1 (
    echo Starting API server...
    pm2 start server/index.js --name ai-trader-api --no-autorestart false >NUL 2>&1
) else (
    echo Restarting API server...
    pm2 restart ai-trader-api >NUL 2>&1
)

:: ── Step 3: Start autonomous trading loop ───────────────────
pm2 describe ai-trader-loop >NUL 2>&1
if ERRORLEVEL 1 (
    echo Starting trading loop...
    pm2 start server/autonomous/scheduler.js --name ai-trader-loop --no-autorestart false >NUL 2>&1
) else (
    echo Restarting trading loop...
    pm2 restart ai-trader-loop >NUL 2>&1
)

:: ── Step 4: Save PM2 process list so it survives reboots ────
pm2 save >NUL 2>&1

echo.
echo ============================================================
echo   AI TRADER IS RUNNING
echo   Dashboard: http://localhost:3000
echo   Logs:      pm2 logs ai-trader-loop
echo ============================================================
echo.
