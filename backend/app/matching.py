"""Búsqueda de personas por nombre escrito "a mano" (planillas de carga masiva).

Se usa en la revisión previa de la carga masiva de signos: si el nombre no coincide
exacto, se proponen personas parecidas para que el usuario confirme. Nunca se asigna
una persona "adivinada" sin confirmación.
"""

import re
import unicodedata
from difflib import SequenceMatcher

from .models import Persona

UMBRAL_SUGERENCIA = 0.72
MAX_CANDIDATOS = 3


def normalizar(texto: str | None) -> str:
    if not texto:
        return ""
    sin_tildes = "".join(
        ch for ch in unicodedata.normalize("NFD", texto.casefold()) if unicodedata.category(ch) != "Mn"
    )
    return re.sub(r"\s+", " ", sin_tildes).strip()


def es_dni(identificador: str) -> bool:
    return bool(re.fullmatch(r"\d{6,9}", re.sub(r"[\s.-]", "", identificador.strip())))


def limpiar_dni(identificador: str) -> str:
    return re.sub(r"[\s.-]", "", identificador.strip())


def separar_nombre_apellido(identificador: str) -> tuple[str, str]:
    """Misma regla que la carga: la última palabra es el apellido y el resto el nombre."""
    partes = identificador.split()
    if len(partes) < 2:
        return (partes[0] if partes else ""), ""
    return " ".join(partes[:-1]), partes[-1]


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def es_coincidencia_exacta(identificador: str, persona: Persona) -> bool:
    nombre, apellido = separar_nombre_apellido(identificador)
    if not apellido:
        return False
    return normalizar(persona.nombre) == normalizar(nombre) and normalizar(persona.apellido) == normalizar(apellido)


def similitud(identificador: str, persona: Persona) -> float:
    """Puntaje 0..1 de qué tan parecido es lo escrito a la persona."""
    texto = normalizar(identificador)
    nombre = normalizar(persona.nombre)
    apellido = normalizar(persona.apellido)
    tokens = texto.split()
    if not tokens:
        return 0.0

    if len(tokens) == 1:
        # Solo un nombre (ej. "Xiomara", "Emili"): se compara contra cada palabra del nombre y del apellido.
        palabra = tokens[0]
        mejor_nombre = max((_ratio(palabra, t) for t in nombre.split()), default=0.0)
        mejor_apellido = max((_ratio(palabra, t) for t in apellido.split()), default=0.0)
        return round(max(mejor_nombre * 0.9, mejor_apellido * 0.8), 3)

    puntaje = max(
        _ratio(texto, f"{nombre} {apellido}"),
        _ratio(texto, f"{apellido} {nombre}"),  # escrito al revés: "Muñoz Yesica"
    )

    # Nombre abreviado o completo con el mismo apellido ("Magdalena Bayón" / "Magda Bayon").
    nombre_escrito, apellido_escrito = separar_nombre_apellido(texto)
    if _ratio(apellido_escrito, apellido) >= 0.85:
        primer_escrito = nombre_escrito.split()[0]
        primer_real = nombre.split()[0] if nombre else ""
        if primer_real and (primer_escrito.startswith(primer_real) or primer_real.startswith(primer_escrito)):
            puntaje = max(puntaje, 0.85)
    return round(puntaje, 3)


def candidatos(identificador: str, personas: list[Persona]) -> list[tuple[Persona, float]]:
    puntajes = [(p, similitud(identificador, p)) for p in personas]
    puntajes = [item for item in puntajes if item[1] >= UMBRAL_SUGERENCIA]
    puntajes.sort(key=lambda item: item[1], reverse=True)
    return puntajes[:MAX_CANDIDATOS]
