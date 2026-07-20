"""Captura de audio del micrófono y transcripción por chunks con faster-whisper.

El audio se corta en ventanas de CHUNK_SECONDS con un solape de
OVERLAP_SECONDS. Cada chunk se transcribe y se descarta inmediatamente:
en memoria solo vive el buffer en curso y la cola de chunks pendientes.
"""
import queue
import threading
import time

import numpy as np
import sounddevice as sd

from merge import merge_overlap

SAMPLE_RATE = 16000
DEFAULT_CHUNK_SECONDS = 20.0
OVERLAP_SECONDS = 2.0
# ~30 chunks pendientes = ~4 min de retraso máximo y ~20 MB de RAM.
MAX_QUEUE_CHUNKS = 30


def list_input_devices():
    devices = []
    try:
        default_in = sd.default.device[0]
    except Exception:
        default_in = -1
    for idx, dev in enumerate(sd.query_devices()):
        if dev.get("max_input_channels", 0) > 0:
            devices.append({"id": idx, "name": dev["name"], "default": idx == default_in})
    return devices


class Transcriber:
    def __init__(self, on_segment, on_status, language="es"):
        self.on_segment = on_segment
        self.on_status = on_status
        self.language = language
        self.model = None
        self.model_size = None
        self.recording = False
        self._busy = False
        self._lock = threading.Lock()
        self._q = queue.Queue()
        self._worker = None
        self._stream = None
        self._buffer = []
        self._buffered = 0
        self._prev_text = ""
        self._chunk_samples = int(SAMPLE_RATE * DEFAULT_CHUNK_SECONDS)
        self._step_samples = self._chunk_samples - int(SAMPLE_RATE * OVERLAP_SECONDS)

    # ------------------------------------------------------------- control
    def start(self, model_size="medium", device_id=None,
              chunk_seconds=DEFAULT_CHUNK_SECONDS, language=None):
        with self._lock:
            if self.recording:
                return
            self._prev_text = ""
            self._buffer, self._buffered = [], 0
            if language:
                self.language = language
            # En chunks cortos el solape se reduce para no repetir demasiado audio.
            overlap = min(OVERLAP_SECONDS, chunk_seconds / 4)
            self._chunk_samples = int(SAMPLE_RATE * chunk_seconds)
            self._step_samples = self._chunk_samples - int(SAMPLE_RATE * overlap)
            self.recording = True

        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._worker_loop, daemon=True)
            self._worker.start()

        self._q.put(("model", model_size))
        try:
            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=4000,
                device=device_id,
                callback=self._audio_cb,
            )
            self._stream.start()
        except Exception as exc:
            self.recording = False
            self.on_status({"state": "error",
                            "message": f"No se pudo abrir el micrófono: {exc}"})
            raise
        self.on_status({"state": "recording", "pending": self._q.qsize()})

    def wait_idle(self, timeout=20.0):
        """Espera (hasta timeout) a que se transcriba lo que queda en cola."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._q.empty() and not self._busy:
                return True
            time.sleep(0.2)
        return False

    def stop(self):
        with self._lock:
            if not self.recording:
                return
            self.recording = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        # Transcribir lo que quede en el buffer si hay más de 1 s de audio.
        if self._buffered > SAMPLE_RATE:
            self._enqueue(np.concatenate(self._buffer))
        self._buffer, self._buffered = [], 0
        self.on_status({"state": "finishing", "pending": self._q.qsize()})

    # ------------------------------------------------------------- captura
    def _audio_cb(self, indata, frames, time_info, status):
        if not self.recording:
            return
        self._buffer.append(indata[:, 0].copy())
        self._buffered += frames
        if self._buffered >= self._chunk_samples:
            data = np.concatenate(self._buffer)
            chunk = data[:self._chunk_samples]
            rest = data[self._step_samples:]
            self._buffer = [rest]
            self._buffered = len(rest)
            self._enqueue(chunk)

    def _enqueue(self, chunk):
        if self._q.qsize() >= MAX_QUEUE_CHUNKS:
            # La transcripción va más lenta que el audio: se descarta el
            # chunk más antiguo para no crecer en memoria sin límite.
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self.on_status({"state": "warning",
                            "message": "La transcripción va retrasada; se descartó un fragmento."})
        self._q.put(("chunk", chunk))

    # ------------------------------------------------------------- worker
    def _ensure_model(self, size):
        if self.model is not None and self.model_size == size:
            return
        from faster_whisper import WhisperModel
        self.on_status({"state": "loading_model", "model": size})
        self.model = WhisperModel(size, device="cpu", compute_type="int8")
        self.model_size = size

    def _worker_loop(self):
        while True:
            kind, payload = self._q.get()
            self._busy = True
            try:
                if kind == "model":
                    self._ensure_model(payload)
                elif kind == "chunk":
                    self._process_chunk(payload)
            except Exception as exc:
                self.on_status({"state": "error", "message": str(exc)})
            finally:
                self._busy = False
            if not self.recording and self._q.empty():
                self.on_status({"state": "idle"})

    def _process_chunk(self, chunk):
        if self.model is None:
            return
        # Silencio digital: no vale la pena pasar por el modelo.
        if float(np.sqrt(np.mean(chunk ** 2))) < 1e-4:
            self._prev_text = ""
            return
        if self.recording:
            self.on_status({"state": "transcribing", "pending": self._q.qsize()})
        segments, _info = self.model.transcribe(
            chunk,
            language=self.language,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        parts = [s.text.strip() for s in segments if s.no_speech_prob < 0.7]
        text = " ".join(p for p in parts if p).strip()
        if not text:
            self._prev_text = ""
            return
        addition = merge_overlap(self._prev_text, text) if self._prev_text else text
        self._prev_text = text
        addition = addition.strip()
        if addition:
            self.on_segment(addition)
        if self.recording:
            self.on_status({"state": "recording", "pending": self._q.qsize()})
