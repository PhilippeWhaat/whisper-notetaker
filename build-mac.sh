#!/bin/bash
# Construye "Note Taker.app" (macOS). Uso: ./build-mac.sh
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/pip install -q -r requirements.txt pyinstaller
.venv/bin/pyinstaller notetaker.spec --noconfirm

# Limpiar atributos extendidos y firmar ad-hoc para que macOS lo acepte.
xattr -cr "dist/Note Taker.app"
dot_clean "dist/Note Taker.app" 2>/dev/null || true
codesign --force --deep --sign - "dist/Note Taker.app" || {
  # A veces Spotlight/Finder vuelve a etiquetar archivos a mitad de firma.
  xattr -cr "dist/Note Taker.app"
  codesign --force --deep --sign - "dist/Note Taker.app"
}
ditto -c -k --keepParent "dist/Note Taker.app" "dist/NoteTaker-macOS.zip"

echo
echo "✅ Listo: dist/Note Taker.app  (arrástralo a /Applications si quieres)"
