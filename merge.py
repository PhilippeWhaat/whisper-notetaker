"""Fusión de transcripciones de chunks de audio solapados.

Los chunks de audio se solapan ~2 s, así que el principio del texto nuevo
suele repetir el final del texto anterior, pero con variaciones típicas de
Whisper: puntuación distinta, mayúsculas que cambian, signos sueltos como
token propio, y la última palabra del chunk anterior cortada a mitad de
audio ("transcripci" vs "transcripción"). La comparación es tolerante a
todo eso: normaliza puntuación y mayúsculas, ignora tokens que son solo
signos, acepta palabras cortadas por prefijo/similitud, y permite que la
coincidencia no llegue exactamente a la última palabra del chunk anterior.
"""
import difflib
import re

_NO_WORD = re.compile(r"[\W_]+", re.UNICODE)


def _norm(word: str) -> str:
    return _NO_WORD.sub("", word.lower())


def _similar(a: str, b: str) -> bool:
    """Igualdad tolerante entre palabras normalizadas."""
    if a == b:
        return True
    # Palabra cortada al final del chunk: "transcripci" vs "transcripción".
    if len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
        return True
    # Variación leve de ortografía/acentos.
    if min(len(a), len(b)) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8:
        return True
    return False


def merge_overlap(prev_text: str, new_text: str, max_words: int = 16,
                  min_match: int = 2, end_slack: int = 2) -> str:
    """Devuelve la parte de new_text que no está ya al final de prev_text."""
    prev_words = prev_text.split()
    new_words = new_text.split()
    if not prev_words or not new_words:
        return new_text

    tail_src = prev_words[-max_words:]
    head_src = new_words[: max_words * 2]
    # (índice original, palabra normalizada), ignorando tokens que son solo
    # signos de puntuación ("...", "-", etc.).
    tail = [(i, n) for i, w in enumerate(tail_src) if (n := _norm(w))]
    head = [(i, n) for i, w in enumerate(head_src) if (n := _norm(w))]
    if not tail or not head:
        return new_text

    best_cut = None
    best_score = 0.0
    for ti in range(len(tail)):
        for hi in range(len(head)):
            k = 0
            while (ti + k < len(tail) and hi + k < len(head)
                   and _similar(tail[ti + k][1], head[hi + k][1])):
                k += 1
            if k < min_match:
                continue
            # La coincidencia debe llegar al final del chunk anterior (zona
            # solapada), con tolerancia: las últimas `end_slack` palabras de
            # prev pueden diferir (suelen ser la palabra cortada por el
            # límite del audio). Cuanta más tolerancia se usa, más larga
            # debe ser la evidencia.
            remaining = len(tail) - (ti + k)
            if remaining > end_slack or k < min_match + remaining:
                continue
            # Cortar new tras la coincidencia y saltar además su versión de
            # las palabras sobrantes de prev (ya escritas en el documento).
            cut = head[hi + k - 1][0] + 1 + remaining
            cut = min(cut, len(new_words))
            score = k - remaining * 0.5
            if score > best_score:
                best_score = score
                best_cut = cut

    if best_cut is None:
        return new_text
    return " ".join(new_words[best_cut:])
