"""Personas repetidas: registros que parecen la misma persona escrita distinto
("Ema" / "Emanuel", "Manu" / "Manuel", "Marelo" / "Marcelo Tercero").

Se arma un grafo con las parejas parecidas y cada grupo conectado es una propuesta.
En la pantalla se destilda a quien no corresponde y se unifica el resto en un solo registro.
"""

from .matching import similitud_personas
from .models import Persona

UMBRAL_REPETIDOS = 0.75


def grupos_repetidos(personas: list[Persona], distintas: set[tuple[int, int]]) -> list[list[tuple[Persona, Persona, float]]]:
    """Devuelve los grupos como listas de parejas (a, b, similitud) que los conectan."""
    padre = {p.id: p.id for p in personas}

    def raiz(x: int) -> int:
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    parejas: list[tuple[Persona, Persona, float]] = []
    for i, a in enumerate(personas):
        for b in personas[i + 1:]:
            if (min(a.id, b.id), max(a.id, b.id)) in distintas:
                continue
            puntaje = similitud_personas(a, b)
            if puntaje >= UMBRAL_REPETIDOS:
                parejas.append((a, b, puntaje))
                padre[raiz(a.id)] = raiz(b.id)

    grupos: dict[int, list] = {}
    for a, b, puntaje in parejas:
        grupos.setdefault(raiz(a.id), []).append((a, b, puntaje))
    return list(grupos.values())
