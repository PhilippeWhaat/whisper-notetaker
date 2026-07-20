@echo off
REM Construye la app para Windows. Requiere Python 3.10+ instalado
REM (https://www.python.org/downloads/ - marcar "Add Python to PATH").
REM Uso: doble clic en este archivo, en una maquina Windows.
cd /d %~dp0

if not exist .venv (py -3 -m venv .venv)
.venv\Scripts\pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller notetaker.spec --noconfirm

echo.
echo Listo: carpeta "dist\Note Taker" con "Note Taker.exe" dentro.
echo Puedes copiar esa carpeta entera a cualquier PC (no necesita Python).
pause
