"""Punto de entrada: levanta el servidor local y abre la ventana de la app.

Usa pywebview (webview nativo del sistema) para no depender del navegador
instalado. Si pywebview no está disponible (p. ej. faltan librerías GTK en
Linux), abre la interfaz en el navegador por defecto.
"""
import multiprocessing
import os
import socket
import threading
import time

import uvicorn

from server import app, transcriber, _config_dir

WINDOW_TITLE = "Note Taker"


def _storage_dir():
    """Carpeta persistente para el estado del webview (localStorage, etc.)."""
    path = _config_dir() / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("El servidor local no arrancó a tiempo")


def main():
    port = int(os.environ.get("NOTETAKER_PORT", 0)) or _free_port()
    url = f"http://127.0.0.1:{port}"

    server_thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "127.0.0.1", "port": port, "log_level": "warning"},
        daemon=True,
    )
    server_thread.start()
    _wait_for_server(port)

    if os.environ.get("NOTETAKER_NO_WINDOW"):
        # Modo servidor sin ventana (pruebas / uso desde otro navegador).
        print(f"Interfaz disponible en {url}  —  Ctrl+C para salir.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        transcriber.stop()
        transcriber.wait_idle(timeout=20)
        os._exit(0)

    try:
        import webview
        webview.create_window(WINDOW_TITLE, url, width=1150, height=780, min_size=(720, 480))
        # private_mode=False + storage_path → el localStorage (idioma, moneda,
        # ajustes) persiste entre sesiones. Por defecto pywebview arranca en
        # modo privado y se borraría todo al cerrar la ventana.
        webview.start(private_mode=False, storage_path=str(_storage_dir()))
    except Exception as exc:
        print(f"No se pudo abrir la ventana nativa ({exc}); abriendo el navegador…")
        import webbrowser
        webbrowser.open(url)
        print(f"Interfaz disponible en {url}  —  Ctrl+C para salir.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass

    # Al cerrar la ventana: detener la captura y terminar de transcribir lo
    # pendiente (hasta 20 s) para que las últimas palabras queden en el .md.
    transcriber.stop()
    transcriber.wait_idle(timeout=20)
    # El worker de transcripción y uvicorn son hilos daemon: salida limpia.
    os._exit(0)


if __name__ == "__main__":
    # Necesario para ejecutables PyInstaller (evita relanzar la app al usar
    # multiprocessing en Windows/macOS).
    multiprocessing.freeze_support()
    main()
