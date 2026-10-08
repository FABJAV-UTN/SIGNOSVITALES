"""Revisión previa compartida por las cargas masivas (personas, signos y kits).

Cada fila trae los datos de la persona en columnas separadas: Nombre, Apellido, DNI y
Fecha de nacimiento. Cualquiera puede venir en blanco. Las filas se agrupan por persona
y, para cada grupo, se dice si la persona ya existe, si hay que confirmar a quién
corresponde o si no existe (y se puede crear).

Reglas principales:
- Con DNI que ya está en la base: es esa persona. Si el nombre de la planilla no se
  parece al de la base, se pide confirmar ("conflicto_dni"): puede ser un DNI mal escrito.
- Con DNI que NO está en la base: se busca por nombre. Si aparece alguien con ese nombre
  y sin DNI, es esa persona y el frontend ofrece completarle el DNI. Si aparece con otro
  DNI, se pide confirmar (puede ser un homónimo).
- Sin DNI: se busca por nombre (exacto o parecido), igual que antes.
El frontend compara el DNI y la fecha de nacimiento de la planilla con los de la persona
elegida y ofrece completarlos o actualizarlos.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from types import SimpleNamespace

from .matching import UMBRAL_SUGERENCIA, candidatos, coincide_exacto, normalizar, similitud, texto_nombre
from .models import Persona
from .schemas import DatosPersonaFila, IdentificadorRevision, PersonaCandidata


@dataclass
class _Grupo:
    filas: list[int] = field(default_factory=list)
    nombres: list[str] = field(default_factory=list)
    apellidos: list[str] = field(default_factory=list)
    fechas: list[date] = field(default_factory=list)
    dni: str | None = None

    def agregar(self, fila: int, datos: DatosPersonaFila) -> None:
        self.filas.append(fila)
        if datos.nombre:
            self.nombres.append(datos.nombre)
        if datos.apellido:
            self.apellidos.append(datos.apellido)
        if datos.fecha_nacimiento:
            self.fechas.append(datos.fecha_nacimiento)

    @staticmethod
    def _mas_comun(valores: list):
        return Counter(valores).most_common(1)[0][0] if valores else None

    @property
    def nombre(self) -> str | None:
        return self._mas_comun(self.nombres)

    @property
    def apellido(self) -> str | None:
        return self._mas_comun(self.apellidos)

    @property
    def fecha_nacimiento(self) -> date | None:
        return self._mas_comun(self.fechas)

    @property
    def clave_nombre(self) -> str:
        return normalizar(texto_nombre(self.nombre, self.apellido))

    @property
    def etiqueta(self) -> str:
        return DatosPersonaFila(nombre=self.nombre, apellido=self.apellido, dni=self.dni).etiqueta


def _candidata(persona: Persona, puntaje: float = 1.0) -> PersonaCandidata:
    return PersonaCandidata(
        id=persona.id,
        nombre=persona.nombre,
        apellido=persona.apellido,
        dni=persona.dni,
        fecha_nacimiento=persona.fecha_nacimiento,
        similitud=puntaje,
    )


def agrupar_filas(filas: list[tuple[int, DatosPersonaFila]]) -> list[_Grupo]:
    """Agrupa por DNI (si lo hay) o por nombre y apellido. Las filas sin DNI se suman al
    grupo con DNI del mismo nombre cuando en el archivo hay uno solo con ese nombre
    (la misma persona anotada a veces con DNI y a veces sin)."""
    por_dni: dict[str, _Grupo] = {}
    por_nombre: dict[str, _Grupo] = {}
    for fila, datos in filas:
        if datos.dni:
            grupo = por_dni.setdefault(datos.dni, _Grupo(dni=datos.dni))
        else:
            clave = normalizar(texto_nombre(datos.nombre, datos.apellido))
            grupo = por_nombre.setdefault(clave, _Grupo())
        grupo.agregar(fila, datos)

    grupos = list(por_dni.values())
    for clave, grupo in por_nombre.items():
        con_dni = [g for g in por_dni.values() if g.clave_nombre == clave]
        if len(con_dni) == 1:
            destino = con_dni[0]
            destino.filas.extend(grupo.filas)
            destino.nombres.extend(grupo.nombres)
            destino.apellidos.extend(grupo.apellidos)
            destino.fechas.extend(grupo.fechas)
        else:
            grupos.append(grupo)
    for grupo in grupos:
        grupo.filas.sort()
    grupos.sort(key=lambda g: g.filas[0])
    return grupos


def _buscar_por_nombre(grupo: _Grupo, personas: list[Persona], excluir: set[int]):
    exactas = [p for p in personas if p.id not in excluir and coincide_exacto(grupo.nombre, grupo.apellido, p)]
    texto = texto_nombre(grupo.nombre, grupo.apellido)
    parecidas = [(p, s) for p, s in candidatos(texto, personas) if p.id not in excluir] if texto else []
    return exactas, parecidas


def revisar_filas(filas: list[tuple[int, DatosPersonaFila]], personas: list[Persona]) -> list[IdentificadorRevision]:
    """filas: lista de (número de fila, datos de la persona) de las filas válidas."""
    por_dni = {p.dni: p for p in personas if p.dni}
    revision: list[IdentificadorRevision] = []

    for grupo in agrupar_filas(filas):
        item = IdentificadorRevision(
            identificador=grupo.etiqueta,
            filas=grupo.filas,
            estado="no_encontrada",
            nombre_sugerido=grupo.nombre or "",
            apellido_sugerido=grupo.apellido or "",
            dni=grupo.dni,
            fecha_nacimiento=grupo.fecha_nacimiento,
        )
        texto = texto_nombre(grupo.nombre, grupo.apellido)
        persona_dni = por_dni.get(grupo.dni) if grupo.dni else None

        if persona_dni is not None:
            item.dni_en_uso_por = persona_dni.id
            puntaje = similitud(texto, persona_dni) if texto else 1.0
            if not texto or coincide_exacto(grupo.nombre, grupo.apellido, persona_dni) or puntaje >= UMBRAL_SUGERENCIA:
                item.estado = "exacta"
                item.persona = _candidata(persona_dni, puntaje)
            else:
                # El DNI es de otra persona: puede estar mal escrito en la planilla.
                item.estado = "conflicto_dni"
                exactas, parecidas = _buscar_por_nombre(grupo, personas, {persona_dni.id})
                item.candidatos = [_candidata(persona_dni, puntaje)]
                item.candidatos += [_candidata(p) for p in exactas]
                item.candidatos += [_candidata(p, s) for p, s in parecidas if p not in exactas]
            revision.append(item)
            continue

        if not texto:
            # Solo DNI, y no está en la base: hay que crearla (y completar el nombre).
            revision.append(item)
            continue

        exactas, parecidas = _buscar_por_nombre(grupo, personas, set())
        if grupo.dni:
            # El DNI no está en la base: se busca a la persona por nombre.
            sin_dni = [p for p in exactas if not p.dni]
            if len(exactas) == 1 and not exactas[0].dni:
                item.estado = "exacta"  # misma persona, cargada antes sin DNI: se ofrece completarlo
                item.persona = _candidata(exactas[0])
            elif len(sin_dni) == 1:
                # Varias con ese nombre, pero una sola sin DNI: es la más probable, se confirma.
                item.estado = "ambigua"
                item.candidatos = [_candidata(sin_dni[0])] + [_candidata(p) for p in exactas if p is not sin_dni[0]]
            elif exactas:
                # Mismo nombre pero con otro DNI: puede ser un homónimo o un DNI mal cargado.
                item.estado = "conflicto_dni"
                item.candidatos = [_candidata(p) for p in exactas]
            elif parecidas:
                item.estado = "sugerencia"
                item.candidatos = [_candidata(p, s) for p, s in parecidas]
        else:
            if len(exactas) == 1:
                item.estado = "exacta"
                item.persona = _candidata(exactas[0])
            elif len(exactas) > 1:
                item.estado = "ambigua"
                item.candidatos = [_candidata(p) for p in exactas]
            elif parecidas:
                item.estado = "sugerencia"
                item.candidatos = [_candidata(p, s) for p, s in parecidas]
        revision.append(item)

    # Entre las que no existen, marcar las que parecen la misma persona escrita distinto
    # (ej. "Marelo Tercero" -> "Marcelo Tercero"), para no crearla dos veces.
    no_encontradas = [r for r in revision if r.estado == "no_encontrada"]
    for i, item in enumerate(no_encontradas):
        texto = texto_nombre(item.nombre_sugerido, item.apellido_sugerido)
        if not texto:
            continue
        for anterior in no_encontradas[:i]:
            if anterior.parecido_a or (item.dni and anterior.dni and item.dni != anterior.dni):
                continue
            falsa = SimpleNamespace(nombre=anterior.nombre_sugerido, apellido=anterior.apellido_sugerido)
            if (anterior.nombre_sugerido or anterior.apellido_sugerido) and similitud(texto, falsa) >= 0.8:
                item.parecido_a = anterior.identificador
                break
    return revision


def resolver_persona(datos: DatosPersonaFila, personas: list[Persona]) -> tuple[Persona | None, str | None]:
    """Para cargas sin revisión previa (fila sin persona_id): DNI exacto o nombre exacto único."""
    if datos.dni:
        persona = next((p for p in personas if p.dni == datos.dni), None)
        if persona:
            return persona, None
    exactas = [p for p in personas if coincide_exacto(datos.nombre, datos.apellido, p)]
    if len(exactas) == 1:
        return exactas[0], None
    if len(exactas) > 1:
        return None, f"hay más de una persona llamada '{texto_nombre(datos.nombre, datos.apellido)}'"
    return None, f"persona no encontrada para '{datos.etiqueta}'"
