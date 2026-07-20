#!/bin/bash
# Construye la app para Linux. Uso: ./build-linux.sh
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/pip install -q -r requirements.txt pyinstaller
.venv/bin/pyinstaller notetaker.spec --noconfirm

echo
echo "✅ Listo: dist/Note Taker/Note Taker  (ejecutable de doble clic)"
echo "   Para la ventana nativa instala webkit2gtk (si no, abre el navegador):"
echo "   sudo apt install gir1.2-webkit2-4.1 python3-gi"
