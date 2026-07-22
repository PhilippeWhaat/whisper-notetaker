"""Auto-actualización: comprobación en GitHub Releases y descarga/instalación
del instalador correcto para cada plataforma.

Estrategia (acordada con el usuario): comprobar en segundo plano y avisar; la
instalación se dispara con un clic. Cada plataforma se actualiza tan
automáticamente como resulta fiable:

  • Windows: instalador Inno Setup en modo silencioso + relanzar.
  • Linux:   reemplazo del .AppImage en su sitio + relanzar.
  • macOS:   montar el DMG y reemplazar la .app; si no hay permisos (o falla
             por Gatekeeper), abrir el DMG para arrastrar a Aplicaciones.

El reemplazo real y el relanzamiento los hace un pequeño script auxiliar que se
lanza desligado del proceso (nueva sesión / proceso separado): así la app puede
terminar y liberar sus archivos ANTES de que se sobrescriban, evitando bloqueos
de "archivo en uso" (crítico en Windows y en el propio ejecutable de Linux).
"""
import json
import os
import platform
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Callable, Optional

# Repositorio de releases. Se puede sobreescribir por entorno para pruebas.
REPO = os.environ.get("NOTETAKER_REPO", "PhilippeWhaat/whisper-notetaker")
CHECK_INTERVAL = 24 * 3600  # comprobación periódica: una vez al día
_CACHE_TTL = 3600           # no repetir la consultas a GitHub más de 1/h
_UA = "NoteTaker-Updater"


def _ssl_context() -> ssl.SSLContext:
    """Contexto TLS con verificación. certifi garantiza un bundle de CAs
    empaquetado por PyInstaller (urllib no siempre encuentra las CAs del
    sistema en la app congelada, sobre todo en macOS)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_SSL = _ssl_context()


# --------------------------------------------------------------- versiones
def parse_version(v: str) -> tuple:
    """'v1.2.3' / '1.2' → (1, 2, 3). Ignora sufijos no numéricos por parte."""
    v = (v or "").strip().lstrip("vV")
    out = []
    for part in v.split(".")[:3]:
        num = ""
        for ch in part:
            if ch.isdigit():
                num += ch
            else:
                break
        out.append(int(num) if num else 0)
    while len(out) < 3:
        out.append(0)
    return tuple(out)


def is_newer(latest: str, current: str) -> bool:
    return parse_version(latest) > parse_version(current)


# ---------------------------------------------------- asset por plataforma
def asset_name() -> Optional[str]:
    """Nombre del asset del release que corresponde a esta plataforma/arquitectura
    (debe coincidir con los nombres publicados por .github/workflows/build.yml)."""
    if sys.platform == "darwin":
        arch = (platform.machine() or "").lower()
        if arch in ("arm64", "aarch64"):
            return "NoteTaker-macOS-AppleSilicon.dmg"
        return "NoteTaker-macOS-Intel.dmg"
    if sys.platform.startswith("win"):
        return "NoteTaker-Windows-Setup.exe"
    if sys.platform.startswith("linux"):
        return "NoteTaker-Linux-x86_64.AppImage"
    return None


# ------------------------------------------------------------- comprobación
_lock = threading.Lock()
_last = {"checked_at": 0.0, "result": None}


def _get_json(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": _UA,
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=15, context=_SSL) as resp:
        return json.load(resp)


def check(current_version: str, force: bool = False) -> dict:
    """Consulta el último release y decide si hay una versión más nueva con un
    asset para esta plataforma. Cachea el resultado (sin errores) durante
    _CACHE_TTL para no golpear la API de GitHub."""
    now = time.time()
    with _lock:
        cached = _last["result"]
        if cached and not force and (now - _last["checked_at"] < _CACHE_TTL):
            return cached

    result = {
        "current": current_version,
        "latest": None,
        "available": False,
        "asset": asset_name(),
        "download_url": None,
        "notes_url": f"https://github.com/{REPO}/releases/latest",
        "error": None,
    }
    try:
        data = _get_json(f"https://api.github.com/repos/{REPO}/releases/latest")
        tag = (data.get("tag_name") or "").strip()
        result["latest"] = tag.lstrip("vV")
        result["notes_url"] = data.get("html_url") or result["notes_url"]
        want = result["asset"]
        for asset in data.get("assets", []):
            if asset.get("name") == want:
                result["download_url"] = asset.get("browser_download_url")
                break
        result["available"] = (
            bool(tag)
            and is_newer(tag, current_version)
            and bool(result["download_url"])
        )
    except Exception as exc:
        result["error"] = str(exc)

    # Solo se cachea (y se marca la hora) una comprobación sin error, para que
    # un fallo de red transitorio no silencie el aviso durante una hora.
    if result["error"] is None:
        with _lock:
            _last["checked_at"] = time.time()
            _last["result"] = result
    return result


def last_result() -> Optional[dict]:
    with _lock:
        return _last["result"]


# ---------------------------------------------------------------- descarga
def _download_dir() -> Path:
    base = Path(tempfile.gettempdir()) / "NoteTaker-update"
    base.mkdir(parents=True, exist_ok=True)
    return base


def download(url: str, dest: Path, progress: Optional[Callable[[int], None]] = None) -> Path:
    """Descarga `url` a `dest` (escritura atómica: .part → rename) informando
    el porcentaje por `progress`."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=60, context=_SSL) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        read = 0
        last_pct = -1
        with open(tmp, "wb") as fh:
            while True:
                chunk = resp.read(262144)
                if not chunk:
                    break
                fh.write(chunk)
                read += len(chunk)
                if progress and total:
                    pct = int(read * 100 / total)
                    if pct != last_pct:
                        last_pct = pct
                        progress(pct)
    os.replace(tmp, dest)
    if progress:
        progress(100)
    return dest


# ---------------------------------------------------- instalación / relanzar
def _spawn_detached(cmd) -> None:
    """Lanza `cmd` totalmente desligado de este proceso, para que sobreviva a
    la salida de la app."""
    if sys.platform.startswith("win"):
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        subprocess.Popen(cmd, close_fds=True,
                         creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
    else:
        subprocess.Popen(cmd, close_fds=True, start_new_session=True)


def _macos_app_path() -> Optional[Path]:
    # .../Note Taker.app/Contents/MacOS/Note Taker  →  .../Note Taker.app
    for parent in Path(sys.executable).parents:
        if parent.suffix == ".app":
            return parent
    return None


def _install_macos(dmg: Path) -> None:
    app = _macos_app_path()
    helper = _download_dir() / "update.sh"
    mnt = _download_dir() / "mnt"
    if app is None:
        # No se pudo localizar el bundle: abrir el DMG y que el usuario arrastre.
        helper.write_text(f'#!/bin/sh\nsleep 1\nopen "{dmg}"\n')
    else:
        stage = app.parent / ".NoteTaker-update.app"
        backup = app.parent / ".NoteTaker-old.app"
        # Solo se borran copias temporales (stage) o la antigua (backup) tras
        # tener la nueva en su sitio: la app en uso nunca se destruye antes de
        # tiempo. Si el intercambio falla, se abre el DMG como respaldo.
        helper.write_text(f'''#!/bin/sh
sleep 1
DMG="{dmg}"
APP="{app}"
STAGE="{stage}"
BACKUP="{backup}"
MNT="{mnt}"
ok=0
rm -rf "$STAGE" "$BACKUP"
mkdir -p "$MNT"
if hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null 2>&1; then
  SRC="$MNT/Note Taker.app"
  if [ -d "$SRC" ] && ditto "$SRC" "$STAGE" >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$STAGE" >/dev/null 2>&1
    if mv "$APP" "$BACKUP" && mv "$STAGE" "$APP"; then
      rm -rf "$BACKUP"
      ok=1
    elif [ ! -e "$APP" ] && [ -d "$BACKUP" ]; then
      mv "$BACKUP" "$APP"
    fi
  fi
  hdiutil detach "$MNT" >/dev/null 2>&1
fi
if [ "$ok" = "1" ]; then
  open "$APP"
else
  open "$DMG"
fi
''')
    os.chmod(helper, 0o755)
    _spawn_detached(["/bin/sh", str(helper)])


def _install_windows(installer: Path) -> None:
    exe = sys.executable  # se relanza el mismo ejecutable tras instalar
    helper = _download_dir() / "update.bat"
    # `ping` como espera portable; el instalador Inno es per-user y silencioso.
    helper.write_text(
        "@echo off\r\n"
        "ping 127.0.0.1 -n 3 >nul\r\n"
        f'"{installer}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART\r\n'
        f'start "" "{exe}"\r\n'
        'del "%~f0"\r\n',
        encoding="utf-8",
    )
    _spawn_detached(["cmd", "/c", str(helper)])


def _install_linux(appimage: Path) -> None:
    # Al ejecutarse como AppImage, $APPIMAGE apunta al archivo en disco (el
    # ejecutable montado por FUSE es aparte, así que se puede sobreescribir).
    target = os.environ.get("APPIMAGE") or sys.executable
    helper = _download_dir() / "update.sh"
    helper.write_text(
        "#!/bin/sh\n"
        "sleep 1\n"
        f'NEW="{appimage}"\n'
        f'TARGET="{target}"\n'
        'chmod +x "$NEW" 2>/dev/null\n'
        'if mv -f "$NEW" "$TARGET" 2>/dev/null; then\n'
        '  chmod +x "$TARGET" 2>/dev/null\n'
        '  "$TARGET" &\n'
        'else\n'
        '  xdg-open "$(dirname "$NEW")" 2>/dev/null || true\n'
        'fi\n'
    )
    os.chmod(helper, 0o755)
    _spawn_detached(["/bin/sh", str(helper)])


def apply(download_url: str, progress: Optional[Callable[[int], None]] = None) -> None:
    """Descarga el asset y lanza el instalador auxiliar desligado. NO cierra ni
    relanza la app: de eso se encarga el llamador (para poder detener antes la
    transcripción y guardar lo pendiente)."""
    want = asset_name()
    if not want:
        raise RuntimeError("Plataforma no soportada para actualización automática")
    dest = _download_dir() / want
    download(download_url, dest, progress)
    if sys.platform == "darwin":
        _install_macos(dest)
    elif sys.platform.startswith("win"):
        _install_windows(dest)
    elif sys.platform.startswith("linux"):
        _install_linux(dest)
    else:
        raise RuntimeError("Plataforma no soportada para actualización automática")


# ---------------------------------------------------------- hilo periódico
def start_periodic(current_version: str, on_available: Callable[[dict], None]) -> None:
    """Lanza un hilo daemon que comprueba al arrancar y cada CHECK_INTERVAL,
    invocando `on_available(result)` cuando hay una versión nueva."""
    def loop():
        time.sleep(20)  # no competir con el arranque de la app
        while True:
            try:
                res = check(current_version, force=True)
                if res.get("available"):
                    on_available(res)
            except Exception:
                pass
            time.sleep(CHECK_INTERVAL)

    threading.Thread(target=loop, daemon=True).start()
