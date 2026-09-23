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
from ..schemas import format_validation_errors, PersonaBulkRequest, PersonaBulkResponse, PersonaBulkRow, PersonaCreate, PersonaListItem, PersonaRead, SignosRead

router = APIRouter(prefix="/personas", tags=["personas"])


def _normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFD", value.casefold())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").strip()


async def _persona_ya_existe(nombre: str, apellido: str, dni: str, db: AsyncSession, seen: set[tuple[str, str, str]] | None = None) -> tuple[bool, str | None]:
    if seen is not None:
        clave = (_normalize_text(nombre), _normalize_text(apellido), dni)
        if clave in seen:
            return True, f"La persona {nombre} {apellido} con DNI {dni} ya existe repetida dentro del archivo."

    resultado = await db.execute(select(Persona))
    for persona in resultado.scalars().all():
        if persona.dni == dni:
            return True, f"La persona con DNI {dni} ya existe en la base de datos."
        if _normalize_text(persona.nombre) == _normalize_text(nombre) and _normalize_text(persona.apellido) == _normalize_text(apellido):
            return True, f"La persona {nombre} {apellido} ya existe en la base de datos."
    return False, None


@router.post("", response_model=PersonaRead, status_code=201)
async def crear_persona(persona_in: PersonaCreate, db: AsyncSession = Depends(get_session)):
    existing = await db.execute(select(Persona).where(Persona.dni == persona_in.dni))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="DNI ya registrado")
    persona = Persona(**persona_in.model_dump())
    db.add(persona)
    await db.commit()
    await db.refresh(persona)
    return persona


@router.post("/bulk", response_model=PersonaBulkResponse, status_code=200)
async def cargar_personas_bulk(
    bulk_request: PersonaBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ok_count = 0
    errores: list[str] = []
    creadas: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    # DNI provisorio para quien no tiene: 9xxxxxxx, siempre el siguiente libre (antes se usaba
    # 90000000 + número de fila, que chocaba entre una carga y otra).
    dnis_existentes = set((await db.execute(select(Persona.dni))).scalars().all())
    proximo_provisorio = max(
        [int(d) for d in dnis_existentes if d.isdigit() and 90000000 <= int(d) < 100000000] + [90000000]
    ) + 1

    def nuevo_dni_provisorio() -> str:
        nonlocal proximo_provisorio
        while str(proximo_provisorio) in dnis_existentes:
            proximo_provisorio += 1
        dni_nuevo = str(proximo_provisorio)
        dnis_existentes.add(dni_nuevo)
        proximo_provisorio += 1
        return dni_nuevo

    if not bulk_request.rows:
        return {"ok": 0, "total": 0, "errores": ["No se recibieron filas para procesar."]}

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        if raw_row is None:
            errores.append(f"Fila {index}: fila vacía o sin datos suficientes")
            continue

        if isinstance(raw_row, dict):
            normalized_row = dict(raw_row)
        elif hasattr(raw_row, "model_dump"):
            normalized_row = raw_row.model_dump()
        else:
            normalized_row = {key: value for key, value in vars(raw_row).items() if not key.startswith("_")}

        if not any(value is not None and str(value).strip() != "" for value in normalized_row.values()):
            errores.append(f"Fila {index}: fila vacía o sin datos suficientes")
            continue

        if isinstance(normalized_row.get("dni"), str):
            normalized_row["dni"] = normalized_row["dni"].strip()
        if normalized_row.get("dni") in (None, ""):
            normalized_row["dni"] = nuevo_dni_provisorio()
        if normalized_row.get("nombre") in (None, ""):
            normalized_row["nombre"] = f"Persona {index}"
        if normalized_row.get("apellido") in (None, ""):
            normalized_row["apellido"] = f"SinApellido{index}"

        try:
            row = PersonaBulkRow.model_validate(normalized_row)
        except ValidationError as exc:
            errores.append(f"Fila {index}: datos inválidos ({format_validation_errors(exc)})")
            continue
        except Exception as exc:
            errores.append(f"Fila {index}: datos inválidos ({exc})")
            continue

        dni = (row.dni or "").strip()
        nombre = (row.nombre or "").strip() or f"Sin Nombre {index}"
        apellido = (row.apellido or "").strip() or f"Sin Apellido {index}"

        existe, detalle = await _persona_ya_existe(nombre, apellido, dni, db, seen)
        if existe:
            errores.append(f"Fila {index}: {detalle}")
            continue

        seen.add((_normalize_text(nombre), _normalize_text(apellido), dni))

        persona = Persona(
            nombre=nombre,
            apellido=apellido,
            dni=dni,
            fecha_nacimiento=row.fecha_nacimiento,
            genero=row.genero,
            situacion_de_calle=row.situacion_de_calle,
        )
        db.add(persona)
        await db.flush()
        creadas.append({"fila": index, "id": persona.id, "nombre": nombre, "apellido": apellido, "dni": dni})
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "total": len(bulk_request.rows), "errores": errores, "creadas": creadas}


@router.get("", response_model=list[PersonaListItem])
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
            if dni_termino and persona.dni.startswith(dni_termino):
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


@router.get("/{dni}", response_model=PersonaRead)
async def obtener_persona(dni: str, db: AsyncSession = Depends(get_session)):
    dni_clean = re.sub(r"[\s.-]", "", dni.strip())
    resultado = await db.execute(select(Persona).where(or_(Persona.dni == dni, Persona.dni == dni_clean)))
    persona = resultado.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    return persona


@router.get("/{dni}/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_persona(dni: str, db: AsyncSession = Depends(get_session)):
    dni_clean = re.sub(r"[\s.-]", "", dni.strip())
    persona_query = await db.execute(select(Persona).where(or_(Persona.dni == dni, Persona.dni == dni_clean)))
    persona = persona_query.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    consulta = (
        select(RegistroSignosVitales)
        .options(selectinload(RegistroSignosVitales.persona), selectinload(RegistroSignosVitales.operativo))
        .where(RegistroSignosVitales.persona_id == persona.id)
        .order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    )
    resultado = await db.execute(consulta)
    return resultado.scalars().all()
