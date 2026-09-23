"""Revisión previa compartida por las cargas masivas (signos y kits).

Agrupa las filas por identificador (DNI o "Nombre Apellido") y, para cada uno, dice si la
persona existe, si hay personas parecidas que el usuario tiene que confirmar o si no existe.
"""

from types import SimpleNamespace

from .matching import (
    candidatos,
    es_coincidencia_exacta,
    es_dni,
    limpiar_dni,
    normalizar,
    separar_nombre_apellido,
    similitud,
)
from .models import Persona
from .schemas import IdentificadorRevision, PersonaCandidata


def _candidata(persona: Persona, puntaje: float = 1.0) -> PersonaCandidata:
    return PersonaCandidata(
        id=persona.id, nombre=persona.nombre, apellido=persona.apellido, dni=persona.dni, similitud=puntaje
    )


def revisar_identificadores(filas: list[tuple[int, str]], personas: list[Persona]) -> list[IdentificadorRevision]:
    """filas: lista de (número de fila, identificador) de las filas válidas."""
    grupos: dict[str, dict] = {}
    for fila, identificador in filas:
        identificador = identificador.strip()
        clave = limpiar_dni(identificador) if es_dni(identificador) else normalizar(identificador)
        grupo = grupos.setdefault(clave, {"identificador": identificador, "filas": []})
        grupo["filas"].append(fila)

    revision: list[IdentificadorRevision] = []
    for grupo in grupos.values():
        identificador = grupo["identificador"]
        nombre_sug, apellido_sug = separar_nombre_apellido(identificador)
        item = IdentificadorRevision(
            identificador=identificador,
            filas=grupo["filas"],
            estado="no_encontrada",
            nombre_sugerido=nombre_sug,
            apellido_sugerido=apellido_sug,
        )
        if es_dni(identificador):
            dni = limpiar_dni(identificador)
            persona = next((p for p in personas if p.dni in (dni, identificador)), None)
            if persona:
                item.estado = "exacta"
                item.persona = _candidata(persona)
            else:
                item.nombre_sugerido, item.apellido_sugerido = "", ""
        else:
            exactas = [p for p in personas if es_coincidencia_exacta(identificador, p)]
            if len(exactas) == 1:
                item.estado = "exacta"
                item.persona = _candidata(exactas[0])
            elif len(exactas) > 1:
                item.estado = "ambigua"
                item.candidatos = [_candidata(p) for p in exactas]
            else:
                parecidas = candidatos(identificador, personas)
                if parecidas:
                    item.estado = "sugerencia"
                    item.candidatos = [_candidata(p, puntaje) for p, puntaje in parecidas]
        revision.append(item)

    # Entre las que no existen, marcar las que parecen la misma persona escrita distinto.
    no_encontradas = [r for r in revision if r.estado == "no_encontrada" and not es_dni(r.identificador)]
    for i, item in enumerate(no_encontradas):
        for anterior in no_encontradas[:i]:
            if anterior.parecido_a:
                continue
            falsa = SimpleNamespace(nombre=anterior.nombre_sugerido, apellido=anterior.apellido_sugerido)
            if similitud(item.identificador, falsa) >= 0.8:
                item.parecido_a = anterior.identificador
                break
    return revision
