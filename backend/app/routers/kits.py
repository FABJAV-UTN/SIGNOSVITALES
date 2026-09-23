from datetime import date
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from pydantic import ValidationError

from ..auth import get_current_user
from ..database import get_session
from ..models import Kit, Persona
from ..revision import revisar_identificadores
from ..routers.signos import _find_persona_by_identificador
from ..schemas import (
    BulkPreviewResponse,
    FilaInvalida,
    KitBulkRequest,
    KitBulkResponse,
    KitBulkRow,
    KitCreate,
    KitRead,
    format_validation_errors,
)

router = APIRouter(prefix="/kits", tags=["kits"])


@router.post("", response_model=KitRead, status_code=201)
async def entregar_kit(kit_in: KitCreate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    dni_clean = re.sub(r"[\s.-]", "", kit_in.dni.strip())
    persona_res = await db.execute(select(Persona).where(or_(Persona.dni == kit_in.dni, Persona.dni == dni_clean)))
    persona = persona_res.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    kit = Kit(persona_id=persona.id, tipo=kit_in.tipo, fecha_entrega=date.today())
    db.add(kit)
    await db.commit()
    resultado = await db.execute(
        select(Kit)
        .options(selectinload(Kit.persona))
        .where(Kit.id == kit.id)
    )
    return resultado.scalar_one()


@router.get("/entregas", response_model=list[KitRead], dependencies=[Depends(get_current_user)])
async def listar_entregas(
    q: Optional[str] = Query(None, description="Buscar por DNI, nombre o apellido"),
    fecha: Optional[date] = Query(None, description="Filtrar por fecha exacta"),
    desde: Optional[date] = Query(None, description="Fecha desde"),
    hasta: Optional[date] = Query(None, description="Fecha hasta"),
    tipo: Optional[str] = Query(None, description="Tipo de kit (PPAAS / ABRIGO)"),
    db: AsyncSession = Depends(get_session),
):
    consulta = select(Kit).options(selectinload(Kit.persona))
    if q:
        filtro = f"%{q}%"
        dni_clean = re.sub(r"[\s.-]", "", q.strip())
        consulta = consulta.join(Persona).where(
            or_(Persona.dni == q, Persona.dni == dni_clean, Persona.nombre.ilike(filtro), Persona.apellido.ilike(filtro))
        )
    if fecha:
        consulta = consulta.where(Kit.fecha_entrega == fecha)
    if desde:
        consulta = consulta.where(Kit.fecha_entrega >= desde)
    if hasta:
        consulta = consulta.where(Kit.fecha_entrega <= hasta)
    if tipo:
        consulta = consulta.where(Kit.tipo == tipo)

    consulta = consulta.order_by(Kit.fecha_entrega.desc(), Kit.id.desc())
    resultado = await db.execute(consulta)
    return resultado.scalars().all()


@router.get("/dias", dependencies=[Depends(get_current_user)])
async def dias_con_entregas(db: AsyncSession = Depends(get_session)):
    """Retorna los días en que se realizaron entregas de kits con los totales por fecha."""
    consulta = (
        select(
            Kit.fecha_entrega,
            func.count(Kit.id).label("total"),
            func.count(func.nullif(Kit.tipo != "PPAAS", True)).label("ppaas"),
            func.count(func.nullif(Kit.tipo != "ABRIGO", True)).label("abrigo"),
        )
        .group_by(Kit.fecha_entrega)
        .order_by(Kit.fecha_entrega.desc())
    )
    resultado = await db.execute(consulta)
    filas = resultado.all()
    return [
        {
            "fecha": str(row[0]),
            "total": row[1],
            "ppaas": row[2],
            "abrigo": row[3],
        }
        for row in filas
    ]


@router.get("/persona/{dni}", response_model=list[KitRead], dependencies=[Depends(get_current_user)])
async def historial_kits_persona(dni: str, db: AsyncSession = Depends(get_session)):
    dni_clean = re.sub(r"[\s.-]", "", dni.strip())
    persona_res = await db.execute(select(Persona).where(or_(Persona.dni == dni, Persona.dni == dni_clean)))
    persona = persona_res.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")

    consulta = (
        select(Kit)
        .options(selectinload(Kit.persona))
        .where(Kit.persona_id == persona.id)
        .order_by(Kit.fecha_entrega.desc(), Kit.id.desc())
    )
    resultado = await db.execute(consulta)
    return resultado.scalars().all()


# ---------- Carga masiva de entregas ----------

def _parsear_fila_kit(raw_row, index: int) -> tuple[KitBulkRow | None, int, str | None]:
    fila = index
    if isinstance(raw_row, dict) and str(raw_row.get("fila") or "").isdigit():
        fila = int(raw_row["fila"])
    if raw_row is None or (
        isinstance(raw_row, dict)
        and not any(value is not None and str(value).strip() != "" for key, value in raw_row.items() if key != "fila")
    ):
        return None, fila, "fila vacía o sin datos suficientes"
    try:
        row = KitBulkRow.model_validate(raw_row)
    except ValidationError as exc:
        return None, fila, f"datos inválidos ({format_validation_errors(exc)})"
    return row, fila, None


@router.post("/bulk/preview", response_model=BulkPreviewResponse)
async def revisar_kits_bulk(
    bulk_request: KitBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revisión previa (no guarda nada), igual que la de signos: ver app/revision.py."""
    personas = (await db.execute(select(Persona))).scalars().all()
    validas: list[tuple[int, str]] = []
    invalidas: list[FilaInvalida] = []
    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, fila, error = _parsear_fila_kit(raw_row, index)
        if error:
            invalidas.append(FilaInvalida(fila=fila, error=error))
        else:
            validas.append((fila, row.identificador))
    return BulkPreviewResponse(
        total_filas=len(bulk_request.rows),
        identificadores=revisar_identificadores(validas, personas),
        invalidas=invalidas,
    )


@router.post("/bulk", response_model=KitBulkResponse, status_code=201)
async def cargar_kits_bulk(
    bulk_request: KitBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ok_count = 0
    errores: list[str] = []
    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, fila, error = _parsear_fila_kit(raw_row, index)
        if error:
            errores.append(f"Fila {fila}: {error}")
            continue

        if row.persona_id is not None:
            persona = (await db.execute(select(Persona).where(Persona.id == row.persona_id))).scalar_one_or_none()
            if not persona:
                errores.append(f"Fila {fila}: la persona seleccionada ya no existe")
                continue
        else:
            try:
                persona = await _find_persona_by_identificador(row.identificador, db)
            except HTTPException as exc:
                errores.append(f"Fila {fila}: {exc.detail}")
                continue
            if not persona:
                errores.append(f"Fila {fila}: persona no encontrada para '{row.identificador}'")
                continue

        duplicado = await db.execute(
            select(Kit.id).where(Kit.persona_id == persona.id, Kit.tipo == row.tipo, Kit.fecha_entrega == row.fecha)
        )
        if duplicado.first():
            errores.append(
                f"Fila {fila}: entrega duplicada (kit {row.tipo} a {persona.nombre} {persona.apellido} el {row.fecha})"
            )
            continue

        db.add(Kit(persona_id=persona.id, tipo=row.tipo, fecha_entrega=row.fecha))
        await db.flush()
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "errores": errores}
