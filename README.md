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

## Requisitos

- macOS 11+, Windows 10/11 (64 bits) o Linux reciente
- 8 GB de RAM recomendado (4 GB mínimo, con el modelo `small`)
- ~2 GB de espacio libre (incluye el modelo de transcripción)
- Micrófono
- Internet solo la primera vez (descarga del modelo); después, 100 % offline

## Para usuarios: instaladores

No hace falta instalar Python ni usar la terminal. Descárgalo desde
[note-taker.co](https://note-taker.co) o desde la página de
[Releases](https://github.com/PhilippeWhaat/whisper-notetaker/releases/latest).

- **macOS**: `NoteTaker-macOS-AppleSilicon.dmg` (o `-Intel.dmg` para Macs
  anteriores a 2020). Ábrelo y **arrastra `Note Taker` a Aplicaciones**. La
  primera vez, **clic derecho → Abrir** (la app no está notarizada por Apple).
- **Windows**: `NoteTaker-Windows-Setup.exe`. Doble clic → siguiente → listo
  (se instala por usuario, sin permisos de administrador). SmartScreen puede
  avisar la primera vez: "Más información" → "Ejecutar de todas formas".
- **Linux**: `NoteTaker-Linux-x86_64.AppImage`. Dale permiso de ejecución
  (`chmod +x NoteTaker-*.AppImage` o clic derecho → Propiedades → Ejecutar) y
  doble clic. Para la ventana nativa: `sudo apt install gir1.2-webkit2-4.1
  python3-gi` (si falta, se abre en el navegador por defecto).

Las transcripciones se guardan en `Documentos/Note Taker/`.

### Generar los ejecutables

- La forma recomendada es GitHub Actions: crea un tag `vX.Y.Z` (o lanza el
  workflow desde **Actions**) — [.github/workflows/build.yml](.github/workflows/build.yml)
  construye y publica los cuatro instaladores (macOS Apple Silicon `.dmg`,
  macOS Intel `.dmg`, Windows `.exe` con Inno Setup, Linux `.AppImage`).
- En local, `./build-mac.sh` genera el `.dmg` de macOS en `dist/`.

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
