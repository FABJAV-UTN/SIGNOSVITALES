import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Kit, Operativo, Persona, RegistroSignosVitales
from ..revision import revisar_filas
from ..schemas import (
    ActualizacionesRequest,
    ActualizacionesResponse,
    BulkPreviewResponse,
    FilaInvalida,
    PersonaBulkRequest,
    PersonaBulkResponse,
    PersonaBulkRow,
    PersonaCreate,
    PersonaListItem,
    PersonaRead,
    PersonaUpdate,
    SignosRead,
    format_validation_errors,
)

router = APIRouter(prefix="/personas", tags=["personas"])


def _normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFD", value.casefold())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").strip()


def _detalle_dni_en_uso(dni: str, persona: Persona) -> str:
    return f"El DNI {dni} ya lo tiene {persona.nombre} {persona.apellido}."


async def _persona_con_dni(dni: str | None, db: AsyncSession, excluir_id: int | None = None) -> Persona | None:
    if not dni:
        return None
    consulta = select(Persona).where(Persona.dni == dni)
    if excluir_id is not None:
        consulta = consulta.where(Persona.id != excluir_id)
    return (await db.execute(consulta)).scalars().first()


@router.post("", response_model=PersonaRead, status_code=201, dependencies=[Depends(get_current_user)])
async def crear_persona(persona_in: PersonaCreate, db: AsyncSession = Depends(get_session)):
    existente = await _persona_con_dni(persona_in.dni, db)
    if existente is not None:
        raise HTTPException(status_code=400, detail=_detalle_dni_en_uso(persona_in.dni, existente))
    persona = Persona(**persona_in.model_dump())
    db.add(persona)
    await db.commit()
    await db.refresh(persona)
    return persona


@router.post("/bulk/preview", response_model=BulkPreviewResponse)
async def revisar_personas_bulk(
    bulk_request: PersonaBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revisión previa de la planilla de personas (no guarda nada): misma lógica que signos y kits.
    Dice quién ya existe (y qué datos se le pueden completar) y a quién hay que crear."""
    personas = (await db.execute(select(Persona))).scalars().all()
    validas: list[tuple[int, PersonaBulkRow]] = []
    invalidas: list[FilaInvalida] = []
    for index, raw_row in enumerate(bulk_request.rows, start=1):
        fila = index
        if isinstance(raw_row, dict) and str(raw_row.get("fila") or "").isdigit():
            fila = int(raw_row["fila"])
        if _fila_vacia(raw_row):
            invalidas.append(FilaInvalida(fila=fila, error="fila vacía o sin datos suficientes"))
            continue
        try:
            row = PersonaBulkRow.model_validate(raw_row)
        except ValidationError as exc:
            invalidas.append(FilaInvalida(fila=fila, error=f"datos inválidos ({format_validation_errors(exc)})"))
            continue
        if not row.tiene_datos_persona():
            invalidas.append(FilaInvalida(fila=fila, error="falta la persona: completar Nombre y Apellido, DNI o ambos"))
            continue
        validas.append((fila, row))
    return BulkPreviewResponse(
        total_filas=len(bulk_request.rows),
        identificadores=revisar_filas(validas, personas),
        invalidas=invalidas,
    )


def _fila_vacia(raw_row) -> bool:
    return raw_row is None or (
        isinstance(raw_row, dict)
        and not any(value is not None and str(value).strip() != "" for key, value in raw_row.items() if key != "fila")
    )


@router.post("/bulk", response_model=PersonaBulkResponse, status_code=200)
async def cargar_personas_bulk(
    bulk_request: PersonaBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Da de alta las personas recibidas (las que se confirmaron en la revisión previa).

    El DNI es opcional: si no viene, la persona queda sin DNI y se puede completar después.
    Se rechaza un DNI que ya tenga otra persona y las filas repetidas dentro del mismo pedido.
    """
    ok_count = 0
    errores: list[str] = []
    creadas: list[dict] = []
    vistos_dni: set[str] = set()
    vistos_nombre: set[tuple[str, str]] = set()

    if not bulk_request.rows:
        return {"ok": 0, "total": 0, "errores": ["No se recibieron filas para procesar."]}

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        if _fila_vacia(raw_row):
            errores.append(f"Fila {index}: fila vacía o sin datos suficientes")
            continue
        try:
            row = PersonaBulkRow.model_validate(raw_row)
        except ValidationError as exc:
            errores.append(f"Fila {index}: datos inválidos ({format_validation_errors(exc)})")
            continue

        nombre = row.nombre or ""
        apellido = row.apellido or ""
        if not nombre:
            errores.append(f"Fila {index}: falta el nombre ({row.etiqueta or 'sin datos'})")
            continue

        if row.dni:
            if row.dni in vistos_dni:
                errores.append(f"Fila {index}: el DNI {row.dni} está repetido en la carga.")
                continue
            existente = await _persona_con_dni(row.dni, db)
            if existente is not None:
                errores.append(f"Fila {index}: {_detalle_dni_en_uso(row.dni, existente)}")
                continue
        else:
            clave = (_normalize_text(nombre), _normalize_text(apellido))
            if clave in vistos_nombre:
                errores.append(f"Fila {index}: {nombre} {apellido} está repetida en la carga.")
                continue
            vistos_nombre.add(clave)
        if row.dni:
            vistos_dni.add(row.dni)

        persona = Persona(
            nombre=nombre,
            apellido=apellido,
            dni=row.dni,
            fecha_nacimiento=row.fecha_nacimiento,
            genero=row.genero,
            situacion_de_calle=row.situacion_de_calle,
        )
        db.add(persona)
        await db.flush()
        creadas.append({"fila": index, "id": persona.id, "nombre": nombre, "apellido": apellido, "dni": row.dni})
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "total": len(bulk_request.rows), "errores": errores, "creadas": creadas}


@router.post("/actualizar", response_model=ActualizacionesResponse)
async def actualizar_datos_personas(
    request: ActualizacionesRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Completa o actualiza el DNI y/o la fecha de nacimiento de personas existentes
    (lo que se confirmó en la revisión de una carga masiva)."""
    ok = 0
    errores: list[str] = []
    for cambio in request.cambios:
        persona = await db.get(Persona, cambio.persona_id)
        if persona is None:
            errores.append(f"Persona #{cambio.persona_id}: ya no existe")
            continue
        nombre = f"{persona.nombre} {persona.apellido}"
        if cambio.dni and cambio.dni != persona.dni:
            otra = await _persona_con_dni(cambio.dni, db, excluir_id=persona.id)
            if otra is not None:
                errores.append(f"{nombre}: no se actualizó el DNI. {_detalle_dni_en_uso(cambio.dni, otra)}")
            else:
                persona.dni = cambio.dni
        if cambio.fecha_nacimiento:
            persona.fecha_nacimiento = cambio.fecha_nacimiento
        await db.flush()
        ok += 1
    await db.commit()
    return {"ok": ok, "errores": errores}


@router.get("", response_model=list[PersonaListItem], dependencies=[Depends(get_current_user)])
async def listar_personas(
    q: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
):
    """Lista personas con el total de signos tomados y kits entregados.

    La búsqueda separa el texto en palabras: cada palabra tiene que aparecer en el
    nombre, el apellido o el comienzo del DNI, sin importar mayúsculas ni tildes.
    Así "juan perez", "Pérez Juan", "2776" o "juan" encuentran a la persona.
    (Se filtra en Python porque SQLite no compara sin tildes; el padrón es chico.)
    """
    total_signos = (
        select(func.count(RegistroSignosVitales.id))
        .where(RegistroSignosVitales.persona_id == Persona.id)
        .correlate(Persona)
        .scalar_subquery()
    )
    total_kits = (
        select(func.count(Kit.id)).where(Kit.persona_id == Persona.id).correlate(Persona).scalar_subquery()
    )
    consulta = select(Persona, total_signos.label("total_signos"), total_kits.label("total_kits")).order_by(
        Persona.apellido, Persona.nombre
    )
    resultado = await db.execute(consulta)

    terminos = [_normalize_text(t) for t in (q or "").split() if t.strip()]

    def coincide(persona: Persona) -> bool:
        if not terminos:
            return True
        nombre = _normalize_text(persona.nombre)
        apellido = _normalize_text(persona.apellido)
        for termino in terminos:
            dni_termino = re.sub(r"[\s.-]", "", termino)
            if termino in nombre or termino in apellido:
                continue
            if dni_termino and persona.dni and persona.dni.startswith(dni_termino):
                continue
            return False
        return True

    personas = []
    for persona, signos, kits in resultado.all():
        if not coincide(persona):
            continue
        item = PersonaListItem.model_validate(persona)
        item.total_signos = signos or 0
        item.total_kits = kits or 0
        personas.append(item)
        if limit and len(personas) >= limit:
            break
    return personas


async def _persona_o_404(persona_id: int, db: AsyncSession) -> Persona:
    persona = await db.get(Persona, persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    return persona


@router.get("/{persona_id}", response_model=PersonaListItem, dependencies=[Depends(get_current_user)])
async def obtener_persona(persona_id: int, db: AsyncSession = Depends(get_session)):
    persona = await _persona_o_404(persona_id, db)
    item = PersonaListItem.model_validate(persona)
    item.total_signos = (
        await db.execute(select(func.count(RegistroSignosVitales.id)).where(RegistroSignosVitales.persona_id == persona_id))
    ).scalar_one()
    item.total_kits = (await db.execute(select(func.count(Kit.id)).where(Kit.persona_id == persona_id))).scalar_one()
    return item


@router.patch("/{persona_id}", response_model=PersonaListItem, dependencies=[Depends(get_current_user)])
async def editar_persona(persona_id: int, cambios: PersonaUpdate, db: AsyncSession = Depends(get_session)):
    """Edición a mano (DNI, fecha de nacimiento, nombre, etc.). Solo cambia lo que se manda."""
    persona = await _persona_o_404(persona_id, db)
    datos = cambios.model_dump(exclude_unset=True)
    for obligatorio in ("nombre", "apellido", "situacion_de_calle"):
        if obligatorio in datos and datos[obligatorio] is None:
            del datos[obligatorio]
    if datos.get("dni"):
        otra = await _persona_con_dni(datos["dni"], db, excluir_id=persona.id)
        if otra is not None:
            raise HTTPException(status_code=400, detail=_detalle_dni_en_uso(datos["dni"], otra))
    for campo, valor in datos.items():
        setattr(persona, campo, valor)
    await db.commit()
    return await obtener_persona(persona_id, db)


@router.get("/{persona_id}/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_persona(persona_id: int, db: AsyncSession = Depends(get_session)):
    persona = await _persona_o_404(persona_id, db)
    consulta = (
        select(RegistroSignosVitales)
        .options(selectinload(RegistroSignosVitales.persona), selectinload(RegistroSignosVitales.operativo))
        .where(RegistroSignosVitales.persona_id == persona.id)
        .order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    )
    resultado = await db.execute(consulta)
    return resultado.scalars().all()
