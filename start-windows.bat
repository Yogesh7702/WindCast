@echo off
REM ===========================================================================
REM  WindCast - one-command local run (Windows)
REM  Double-click this file, or run it from cmd/PowerShell:
REM      start-windows.bat
REM  It creates a Python venv, installs dependencies, builds the React app and
REM  serves the whole product (UI + API + docs) on http://localhost:8000
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo ==^> 1/4 Python environment
if not exist .venv (
    python -m venv .venv
    if errorlevel 1 goto :nopython
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
pip install -q -r backend\requirements.txt
if errorlevel 1 goto :pipfail

echo ==^> 2/4 Front-end dependencies
if not exist frontend\node_modules (
    pushd frontend
    call npm install
    if errorlevel 1 goto :npmfail
    popd
)

echo ==^> 3/4 Building the UI
pushd frontend
call npm run build
if errorlevel 1 goto :npmfail
popd

echo ==^> 4/4 Starting WindCast
set DATA_DIR=%cd%\data\snapshot
set STATIC_DIR=%cd%\frontend\dist
echo.
echo     App       : http://localhost:8000
echo     API docs  : http://localhost:8000/docs
echo     Stop with : Ctrl + C
echo.
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
goto :eof

:nopython
echo.
echo [ERROR] Python not found. Install Python 3.10 - 3.13 from https://python.org
echo         and tick "Add python.exe to PATH" during setup.
pause
exit /b 1

:pipfail
echo.
echo [ERROR] pip install failed. Check your internet connection / proxy.
pause
exit /b 1

:npmfail
echo.
echo [ERROR] npm step failed. Install Node.js 18+ from https://nodejs.org and retry.
pause
exit /b 1
