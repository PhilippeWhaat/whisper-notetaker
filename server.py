"""Servidor local: API REST + WebSocket + archivos estáticos de la interfaz."""
import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from transcriber import Transcriber, list_input_devices

BASE_DIR = Path(__file__).resolve().parent
if getattr(sys, "frozen", False):
    # Empaquetado con PyInstaller: los recursos van dentro del ejecutable y
    # las notas a una carpeta visible del usuario.
    STATIC_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR)) / "static"
    NOTES_DIR = Path.home() / "Documents" / "Note Taker"
else:
    STATIC_DIR = BASE_DIR / "static"
    NOTES_DIR = BASE_DIR / "transcripciones"
NOTES_DIR.mkdir(parents=True, exist_ok=True)
# Limpiar temporales huérfanos de un cierre brusco (quedan si el proceso
# muere justo entre escribir el .tmp y renombrarlo).
for _tmp in NOTES_DIR.glob("*.md.tmp"):
    _tmp.unlink(missing_ok=True)
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "es")


def _config_dir() -> Path:
    """Carpeta de configuración por usuario (fuera de la carpeta de notas)."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", str(Path.home())))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    path = base / "Note Taker"
    path.mkdir(parents=True, exist_ok=True)
    return path


PREFS_PATH = _config_dir() / "prefs.json"
_prefs_lock = threading.Lock()


def load_prefs() -> dict:
    try:
        return json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_prefs(prefs: dict):
    tmp = PREFS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(prefs), encoding="utf-8")
    os.replace(tmp, PREFS_PATH)


app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_clients: set = set()
_loop: Optional[asyncio.AbstractEventLoop] = None
_state = {"name": None, "text": ""}
_state_lock = threading.Lock()


# ---------------------------------------------------------------- archivos
def _safe_name(name: str) -> str:
    name = os.path.basename(name).strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    if not name or name == ".md":
        raise HTTPException(400, "Nombre de archivo no válido")
    if not name.endswith(".md"):
        name += ".md"
    return name


def _write_file(name: str, text: str):
    path = NOTES_DIR / name
    tmp = path.with_suffix(".md.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------- websocket
async def _send_all(msg: dict):
    data = json.dumps(msg, ensure_ascii=False)
    dead = []
    for ws in list(_clients):
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)


def broadcast(msg: dict):
    if _loop is not None:
        asyncio.run_coroutine_threadsafe(_send_all(msg), _loop)


# ------------------------------------------------------------- transcriber
def _on_segment(text: str):
    with _state_lock:
        name = _state["name"]
        if not name:
            return
        cur = _state["text"]
        # Whisper suele cerrar cada chunk con un punto porque el audio se
        # corta ahí. Si el segmento nuevo continúa la frase (empieza en
        # minúscula), ese punto era espurio: se retira. Nunca se toca un
        # "..." ni nada seguido de espacio/salto de línea (edición del
        # usuario).
        trim = ""
        if (text and text[0].islower()
                and cur.endswith((".", ",", ";", ":"))
                and not cur.endswith("...")):
            trim = cur[-1]
            cur = cur[:-1]
        sep = "" if (not cur or cur.endswith((" ", "\n"))) else " "
        _state["text"] = cur + sep + text
        _write_file(name, _state["text"])
    broadcast({"type": "segment", "text": sep + text, "trim": trim})


def _on_status(status: dict):
    broadcast({"type": "status", **status})


transcriber = Transcriber(on_segment=_on_segment, on_status=_on_status, language=LANGUAGE)


# ------------------------------------------------------------------ rutas
@app.on_event("startup")
async def _startup():
    global _loop
    _loop = asyncio.get_running_loop()
    with _prefs_lock:
        prefs = load_prefs()
        prefs["launches"] = int(prefs.get("launches", 0)) + 1
        save_prefs(prefs)


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/files")
async def files():
    items = []
    for path in NOTES_DIR.glob("*.md"):
        stat = path.stat()
        items.append({"name": path.name, "mtime": stat.st_mtime, "size": stat.st_size})
    items.sort(key=lambda item: item["mtime"], reverse=True)
    return {"files": items}


class OpenBody(BaseModel):
    name: Optional[str] = None


@app.post("/api/open")
async def open_file(body: OpenBody):
    if transcriber.recording:
        raise HTTPException(409, "Detén la grabación antes de cambiar de archivo")
    if body.name:
        name = _safe_name(body.name)
        path = NOTES_DIR / name
        text = path.read_text(encoding="utf-8") if path.exists() else ""
    else:
        name = datetime.now().strftime("transcripcion-%Y-%m-%d_%H-%M-%S.md")
        text = ""
        _write_file(name, text)
    with _state_lock:
        _state["name"] = name
        _state["text"] = text
    return {"name": name, "text": text}


class SaveBody(BaseModel):
    name: str
    text: str


@app.post("/api/save")
async def save(body: SaveBody):
    name = _safe_name(body.name)
    with _state_lock:
        if _state["name"] == name:
            _state["text"] = body.text
        _write_file(name, body.text)
    return {"ok": True}


class RenameBody(BaseModel):
    old: str
    new: str


@app.post("/api/rename")
async def rename(body: RenameBody):
    old = _safe_name(body.old)
    new = _safe_name(body.new)
    if old == new:
        return {"name": new}
    src, dst = NOTES_DIR / old, NOTES_DIR / new
    if not src.exists():
        raise HTTPException(404, "El archivo original no existe")
    if dst.exists():
        raise HTTPException(409, "Ya existe un archivo con ese nombre")
    src.rename(dst)
    with _state_lock:
        if _state["name"] == old:
            _state["name"] = new
    return {"name": new}


class DeleteBody(BaseModel):
    name: str


TRASH_DIR = NOTES_DIR / "Papelera"


@app.post("/api/delete")
async def delete(body: DeleteBody):
    """"Borrar" = mover a la subcarpeta Papelera/ con renombrado atómico.

    Nunca se elimina nada del disco: el archivo queda visible y recuperable
    en Papelera/, con la fecha del borrado en el nombre. Tras mover se
    verifica que el archivo realmente está en su destino.
    """
    name = _safe_name(body.name)
    path = (NOTES_DIR / name).resolve()
    if path.parent != NOTES_DIR.resolve() or path.suffix != ".md":
        raise HTTPException(400, "Ruta no permitida")
    if not path.is_file():
        raise HTTPException(404, "El archivo no existe")
    with _state_lock:
        if transcriber.recording and _state["name"] == name:
            raise HTTPException(409, "Detén la grabación antes de borrar este archivo")
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        dest = TRASH_DIR / f"{stamp} {name}"
        counter = 1
        while dest.exists():
            counter += 1
            dest = TRASH_DIR / f"{stamp} ({counter}) {name}"
        try:
            os.replace(path, dest)
        except Exception as exc:
            raise HTTPException(500, f"No se pudo mover a la papelera: {exc}")
        # Verificación: el archivo debe estar en el destino y no en el origen.
        if not dest.is_file() or path.exists():
            raise HTTPException(500, "No se pudo verificar el movimiento a la papelera; nada fue borrado definitivamente")
        if _state["name"] == name:
            _state["name"] = None
            _state["text"] = ""
    return {"ok": True, "trashed_to": f"Papelera/{dest.name}"}


_TRASH_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2} (\(\d+\) )?")


def _trash_path(fname: str) -> Path:
    """Ruta segura dentro de Papelera/ (rechaza cualquier cosa fuera)."""
    fname = os.path.basename(fname)
    path = (TRASH_DIR / fname).resolve()
    if path.parent != TRASH_DIR.resolve() or path.suffix != ".md":
        raise HTTPException(400, "Ruta no permitida")
    return path


@app.get("/api/trash")
async def trash_list():
    items = []
    if TRASH_DIR.exists():
        for path in TRASH_DIR.glob("*.md"):
            stat = path.stat()
            display = _TRASH_STAMP.sub("", path.name).replace(".md", "")
            items.append({"file": path.name, "display": display, "mtime": stat.st_mtime})
    items.sort(key=lambda i: i["mtime"], reverse=True)
    return {"items": items}


class TrashFileBody(BaseModel):
    file: str


@app.post("/api/trash/restore")
async def trash_restore(body: TrashFileBody):
    src = _trash_path(body.file)
    if not src.is_file():
        raise HTTPException(404, "El archivo no existe en la papelera")
    # Recuperar el nombre original (sin el sello de fecha del borrado).
    original = _TRASH_STAMP.sub("", src.name) or src.name
    dest = NOTES_DIR / original
    counter = 1
    while dest.exists():
        counter += 1
        dest = NOTES_DIR / f"{original[:-3]} ({counter}).md"
    try:
        os.replace(src, dest)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo restaurar: {exc}")
    return {"ok": True, "name": dest.name}


@app.post("/api/trash/delete")
async def trash_delete(body: TrashFileBody):
    """Borrado DEFINITIVO de un archivo de la papelera (esto sí libera espacio)."""
    path = _trash_path(body.file)
    if not path.is_file():
        raise HTTPException(404, "El archivo no existe en la papelera")
    try:
        path.unlink()
    except Exception as exc:
        raise HTTPException(500, f"No se pudo eliminar: {exc}")
    return {"ok": True}


@app.post("/api/trash/empty")
async def trash_empty():
    """Vacía la papelera: borrado definitivo de todo su contenido."""
    removed = 0
    if TRASH_DIR.exists():
        for path in TRASH_DIR.glob("*.md"):
            try:
                path.unlink()
                removed += 1
            except Exception:
                pass
    return {"ok": True, "removed": removed}


class StartBody(BaseModel):
    name: str
    model: str = "medium"
    device_id: Optional[int] = None
    chunk_seconds: float = 20.0
    language: str = "es"


@app.post("/api/start")
async def start(body: StartBody):
    name = _safe_name(body.name)
    with _state_lock:
        if _state["name"] != name:
            path = NOTES_DIR / name
            _state["name"] = name
            _state["text"] = path.read_text(encoding="utf-8") if path.exists() else ""
    if body.model not in ("tiny", "base", "small", "medium"):
        raise HTTPException(400, "Modelo no válido")
    if body.language not in ("es", "en", "fr"):
        raise HTTPException(400, "Idioma no válido")
    if not 3 <= body.chunk_seconds <= 30:
        raise HTTPException(400, "La duración del fragmento debe estar entre 3 y 30 s")
    try:
        transcriber.start(model_size=body.model, device_id=body.device_id,
                          chunk_seconds=body.chunk_seconds, language=body.language)
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return {"ok": True}


@app.post("/api/stop")
async def stop():
    transcriber.stop()
    return {"ok": True}


@app.get("/api/devices")
async def devices():
    try:
        return {"devices": list_input_devices()}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/status")
async def status():
    with _state_lock:
        return {"recording": transcriber.recording, "name": _state["name"]}


@app.post("/api/reveal")
async def reveal():
    folder = str(NOTES_DIR)
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        elif sys.platform.startswith("win"):
            os.startfile(folder)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", folder])
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return {"ok": True}


# --------------------------------------------------------------- donaciones
def _donation_cfg() -> dict:
    try:
        from donation_config import DONATION
        return DONATION
    except Exception:
        return {}


def _region_configured(cfg: dict, region: str) -> bool:
    if region == "mx":
        return any(o.get("url") for o in cfg.get("mx", {}).get("options", []))
    intl = cfg.get("intl", {})
    return bool(intl.get("paypal_me") or intl.get("kofi"))


@app.get("/api/donation/config")
async def donation_config(region: str = "intl"):
    """Perfil según región: 'mx' (MercadoPago, montos en pesos) o 'intl'
    (Ko-fi, el donante elige el monto)."""
    cfg = _donation_cfg()
    signature = cfg.get("signature", "")
    if region == "mx":
        options = [o for o in cfg.get("mx", {}).get("options", []) if o.get("url")]
        return {
            "configured": bool(options),
            "mode": "amounts",
            "currency_symbol": cfg.get("mx", {}).get("currency_symbol", "$"),
            "amounts": [o["amount"] for o in options],
            "signature": signature,
        }
    intl = cfg.get("intl", {})
    if intl.get("paypal_me"):
        # PayPal.me permite prefijar el monto → botones como en México.
        return {
            "configured": True,
            "mode": "amounts",
            "currency_symbol": intl.get("currency_symbol", "$"),
            "amounts": intl.get("amounts", []),
            "signature": signature,
        }
    return {
        "configured": bool(intl.get("kofi")),
        "mode": "kofi",
        "signature": signature,
    }


@app.get("/api/donation/state")
async def donation_state(region: str = "intl"):
    """¿Mostrar el mensaje de donación? No en la 1.ª ejecución (buena primera
    impresión), ni si ya se apoyó o se pidió no volver a mostrarlo, ni si no
    hay enlaces configurados para la región."""
    cfg = _donation_cfg()
    with _prefs_lock:
        prefs = load_prefs()
    should = (_region_configured(cfg, region)
              and not prefs.get("dismissed")
              and int(prefs.get("launches", 0)) >= 2)
    return {"should_prompt": should}


class DonateBody(BaseModel):
    region: str = "intl"
    amount: Optional[int] = None


@app.post("/api/donation/go")
async def donation_go(body: DonateBody):
    """Abre el enlace de pago en el navegador del sistema (MercadoPago para
    México según el monto; Ko-fi para el resto). NO oculta el mensaje: como
    no se puede verificar el pago, el mensaje solo se silencia si la persona
    marca honestamente '¡Ya doné!'. El botón de café sigue siempre visible."""
    cfg = _donation_cfg()
    url = None
    if body.region == "mx":
        for opt in cfg.get("mx", {}).get("options", []):
            if opt.get("amount") == body.amount and opt.get("url"):
                url = opt["url"]
                break
    else:
        intl = cfg.get("intl", {})
        if intl.get("paypal_me"):
            base = f"https://www.paypal.com/paypalme/{intl['paypal_me']}"
            code = intl.get("currency_code", "")
            url = f"{base}/{body.amount}{code}" if body.amount else base
        else:
            url = intl.get("kofi") or None
    if not url:
        raise HTTPException(400, "Las donaciones aún no están configuradas")
    if not os.environ.get("NOTETAKER_NO_BROWSER_OPEN"):
        try:
            webbrowser.open(url)
        except Exception as exc:
            raise HTTPException(500, f"No se pudo abrir el navegador: {exc}")
    return {"ok": True}


@app.post("/api/donation/dismiss")
async def donation_dismiss():
    with _prefs_lock:
        prefs = load_prefs()
        prefs["dismissed"] = True
        save_prefs(prefs)
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # no se esperan mensajes; mantiene viva la conexión
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(ws)
