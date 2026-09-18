import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Operativo, Persona, RegistroSignosVitales
from ..schemas import PersonaBulkRequest, PersonaBulkResponse, PersonaBulkRow, PersonaCreate, PersonaRead, SignosRead

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
    seen: set[tuple[str, str, str]] = set()

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
            normalized_row["dni"] = f"{90000000 + index}"
        if normalized_row.get("nombre") in (None, ""):
            normalized_row["nombre"] = f"Persona {index}"
        if normalized_row.get("apellido") in (None, ""):
            normalized_row["apellido"] = f"SinApellido{index}"

        try:
            row = PersonaBulkRow.model_validate(normalized_row)
        except Exception as exc:
            detalles = ""
            if hasattr(exc, "errors"):
                detalles = ", ".join(error["msg"] for error in exc.errors())
            errores.append(f"Fila {index}: datos inválidos ({detalles or str(exc)})")
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
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "total": len(bulk_request.rows), "errores": errores}


@router.get("", response_model=list[PersonaRead])
async def listar_personas(q: str | None = Query(None), db: AsyncSession = Depends(get_session)):
    consulta = select(Persona)
    if q and q.strip():
        termino = q.strip()
        filtro = f"%{termino}%"
        dni_clean = re.sub(r"[\s.-]", "", termino)
        consulta = consulta.where(
            or_(Persona.dni == termino, Persona.dni == dni_clean, Persona.nombre.ilike(filtro), Persona.apellido.ilike(filtro))
        )
    consulta = consulta.order_by(Persona.apellido, Persona.nombre)
    resultado = await db.execute(consulta)
    return resultado.scalars().all()


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
