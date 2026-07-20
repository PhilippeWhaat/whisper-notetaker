"""Runtime hook de PyInstaller (solo Linux).

La rueda de sounddevice para Linux no incluye PortAudio: el .spec empaqueta
la libportaudio.so.2 del sistema de build, y este hook hace que sounddevice
la encuentre en máquinas donde no está instalada. Si el sistema del usuario
sí la tiene, se usa la del sistema.
"""
import ctypes.util
import os
import sys

_orig_find_library = ctypes.util.find_library


def _find_library(name):
    found = _orig_find_library(name)
    if found is None and name == "portaudio":
        bundled = os.path.join(getattr(sys, "_MEIPASS", ""), "libportaudio.so.2")
        if os.path.exists(bundled):
            return bundled
    return found


ctypes.util.find_library = _find_library
