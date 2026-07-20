# Note Taker

Transcripción en vivo del micrófono, 100 % local, con Whisper (vía
[faster-whisper](https://github.com/SYSTRAN/faster-whisper)). Interfaz web
que se abre en una ventana propia (webview nativo del sistema), por lo que
funciona igual en macOS, Windows y Linux.

## Características

- **Transcripción en vivo**: el audio se corta en chunks de 10 s con 2 s de
  solape; el texto de cada chunk se fusiona con el anterior detectando la
  zona repetida, así no se pierden ni duplican palabras.
- **Editable mientras transcribe**: el texto nuevo siempre aparece al final;
  puedes corregir, borrar o añadir saltos de línea en cualquier parte sin
  interrumpir la transcripción.
- **Autoguardado**: cada chunk transcrito se escribe de inmediato en un `.md`
  dentro de `transcripciones/`. Si se apaga el equipo, no se pierde nada.
- **Pausar / reanudar** sin fricción, y reabrir cualquier `.md` para seguir
  transcribiendo al final.
- **Poco consumo**: modelo cuantizado int8 en CPU, chunks descartados tras
  transcribirse, cola acotada en memoria.

## Para usuarios: ejecutables de doble clic

No hace falta instalar Python ni usar la terminal.

- **macOS**: descarga `NoteTaker-macOS.zip`, descomprime y arrastra
  `Note Taker.app` a Aplicaciones. La primera vez, **clic derecho → Abrir**
  (la app no está notarizada por Apple y macOS la bloquea con doble clic).
- **Windows**: descarga `NoteTaker-Windows.zip`, descomprime la carpeta y haz
  doble clic en `Note Taker.exe` (dentro de la carpeta `Note Taker`).
- **Linux**: descarga `NoteTaker-Linux.zip`, descomprime y doble clic en el
  ejecutable `Note Taker` (si el gestor de archivos quitó el permiso de
  ejecución al extraer: `chmod +x "Note Taker/Note Taker"`). Para la ventana
  nativa: `sudo apt install gir1.2-webkit2-4.1 python3-gi` (si falta, se abre
  en el navegador por defecto). Si el micrófono no funcionara:
  `sudo apt install libportaudio2`.

Las transcripciones se guardan en `Documentos/Note Taker/`.

### Generar los ejecutables

- En cada sistema: doble clic en `build-windows.bat` (Windows) o ejecutar
  `./build-mac.sh` / `./build-linux.sh`. El resultado queda en `dist/`.
  Cada sistema solo puede construir su propio ejecutable.
- O automáticamente para los tres: sube el repo a GitHub y crea un tag
  `v1.0.0` (o lanza el workflow desde la pestaña **Actions**) — el workflow
  [.github/workflows/build.yml](.github/workflows/build.yml) construye y
  publica los tres zips en un release.

## Para desarrollo: ejecutar desde el código

Requiere Python 3.10+.

```bash
cd whisper-notetaker
python3 -m venv .venv
source .venv/bin/activate        # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

- La **primera vez** que grabes, se descargará el modelo Whisper elegido
  (una sola vez; después todo funciona sin internet). El modelo `small`
  (~460 MB) es el recomendado para español.
- **macOS**: la primera grabación pedirá permiso de micrófono para la
  Terminal (o la app desde la que lances el programa).
- **Linux**: la ventana nativa necesita `webkit2gtk` y `pygobject`
  (`sudo apt install gir1.2-webkit2-4.1 python3-gi`). Si no están, la app
  abre automáticamente la interfaz en el navegador por defecto.

## Configuración

| Variable de entorno | Efecto | Por defecto |
|---|---|---|
| `WHISPER_LANGUAGE` | Idioma de la transcripción | `es` |
| `NOTETAKER_PORT` | Puerto del servidor local | aleatorio |

El tamaño del modelo (tiny/base/small/medium) y el micrófono se eligen en la
propia interfaz.

## Cómo funciona

1. `sounddevice` captura el micrófono a 16 kHz mono.
2. Cada 8 s se emite una ventana de 10 s (2 s de solape con la anterior) a
   una cola; el chunk se libera de memoria tras transcribirse.
3. `faster-whisper` transcribe con VAD (filtra silencios) y sin beam search
   para minimizar CPU.
4. El texto nuevo se compara palabra a palabra con el final del texto
   anterior ([merge.py](merge.py)) y solo se añade la parte no repetida.
5. Cada segmento añadido se escribe en el `.md` de forma atómica y se envía
   por WebSocket a la interfaz, que lo añade al final sin tocar el cursor
   del usuario.
