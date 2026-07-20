# -*- mode: python ; coding: utf-8 -*-
# Empaquetado con PyInstaller. Uso:  pyinstaller notetaker.spec
import sys
from PyInstaller.utils.hooks import collect_all

APP_NAME = "Note Taker"

datas = [("static", "static")]
binaries = []
hiddenimports = []

# faster-whisper y sus dependencias nativas cargan recursos en tiempo de
# ejecución (modelo VAD de Silero, librerías de ctranslate2/onnxruntime):
# hay que incluirlos explícitamente.
for pkg in ("faster_whisper", "ctranslate2", "onnxruntime", "tokenizers", "huggingface_hub"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# uvicorn resuelve estos módulos dinámicamente.
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.on",
]

icon = "logo/icon.icns" if sys.platform == "darwin" else "logo/icon.ico"

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    exclude_binaries=True,
    name=APP_NAME,
    console=False,
    icon=icon,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name=APP_NAME,
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon="logo/icon.icns",
        bundle_identifier="com.notetaker.app",
        info_plist={
            "NSMicrophoneUsageDescription":
                "Note Taker necesita acceso al micrófono para transcribir en vivo.",
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.productivity",
        },
    )
