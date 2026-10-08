from datetime import date, datetime, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Operativo, Persona, RegistroSignosVitales
from ..revision import resolver_persona, revisar_filas
from ..schemas import (
    FilaInvalida,
    SignosBulkPreviewResponse,
    SignosBulkRequest,
    SignosBulkResponse,
    SignosBulkRow,
    SignosCreate,
    SignosRead,
    format_validation_errors,
)

router = APIRouter(prefix="/signos", tags=["signos"])


async def _resolve_operativo(operativo_id: Optional[int], lugar_custom: Optional[str], db: AsyncSession) -> Operativo:
    if operativo_id is not None:
        operativo_res = await db.execute(select(Operativo).where(Operativo.id == operativo_id))
        operativo = operativo_res.scalar_one_or_none()
        if not operativo:
            raise HTTPException(status_code=404, detail="Operativo no encontrado")
        return operativo

    if lugar_custom:
        operativo_res = await db.execute(select(Operativo).where(Operativo.lugar == lugar_custom))
        operativo = operativo_res.scalar_one_or_none()
        if operativo:
            return operativo
        operativo = Operativo(lugar=lugar_custom, dia_semana="Custom", hora=time(0, 0), activo=False)
        db.add(operativo)
        await db.flush()
        return operativo

    operativo_res = await db.execute(select(Operativo).where(Operativo.activo.is_(True)))
    operativo = operativo_res.scalar_one_or_none()
    if not operativo:
        raise HTTPException(status_code=500, detail="No existe un operativo activo")
    return operativo


async def persona_de_pedido(persona_id: int | None, dni: str | None, db: AsyncSession) -> Persona:
    """La persona de un alta individual: por id (lo normal) o por DNI (compatibilidad)."""
    persona = None
    if persona_id is not None:
        persona = await db.get(Persona, persona_id)
    elif dni:
        persona = (await db.execute(select(Persona).where(Persona.dni == dni))).scalars().first()
    if persona is None:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    return persona


@router.post("", response_model=SignosRead, status_code=201)
async def crear_signos(signos_in: SignosCreate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    persona = await persona_de_pedido(signos_in.persona_id, signos_in.dni, db)

    operativo = await _resolve_operativo(signos_in.operativo_id, signos_in.lugar_custom, db)
    registro = RegistroSignosVitales(
        persona_id=persona.id,
        operativo_id=operativo.id,
        fecha=signos_in.fecha or date.today(),
        hora=datetime.now().time().replace(microsecond=0),
        presion_arterial=signos_in.presion_arterial,
        frecuencia_cardiaca=signos_in.frecuencia_cardiaca,
        oxigenacion_sangre=signos_in.oxigenacion_sangre,
    )
    db.add(registro)
    await db.commit()
    resultado = await db.execute(
        select(RegistroSignosVitales)
        .options(
            selectinload(RegistroSignosVitales.persona),
            selectinload(RegistroSignosVitales.operativo),
        )
        .where(RegistroSignosVitales.id == registro.id)
    )
    return resultado.scalar_one()


async def persona_de_fila(row, db: AsyncSession) -> tuple[Persona | None, str | None]:
    """Persona de una fila de carga masiva: la confirmada en la revisión (persona_id) o,
    si no vino, la que coincide exacto por DNI o por nombre y apellido."""
    if row.persona_id is not None:
        persona = await db.get(Persona, row.persona_id)
        return (persona, None) if persona else (None, "la persona seleccionada ya no existe")
    personas = (await db.execute(select(Persona))).scalars().all()
    return resolver_persona(row, personas)


def _fila_vacia(raw_row) -> bool:
    return raw_row is None or (
        isinstance(raw_row, dict)
        and not any(value is not None and str(value).strip() != "" for key, value in raw_row.items() if key != "fila")
    )


def _parsear_fila(raw_row) -> tuple[SignosBulkRow | None, tuple | None, str | None]:
    """Valida una fila. Devuelve (fila, (pa, fc, spo2), error)."""
    if _fila_vacia(raw_row):
        return None, None, "fila vacía o sin datos suficientes"
    try:
        row = SignosBulkRow.model_validate(raw_row)
    except ValidationError as exc:
        return None, None, f"datos inválidos ({format_validation_errors(exc)})"
    try:
        partes = [part.strip() for part in row.signos.split("-")]
        if len(partes) != 3:
            return None, None, "formato de signos inválido (esperado PA-FC-SpO2)"
        presion_arterial = partes[0] if partes[0] else "0/0"
        frecuencia_cardiaca = int(partes[1]) if partes[1] else 0
        oxigenacion_sangre = float(partes[2]) if partes[2] else 0.0
    except Exception:
        return None, None, "formato de signos inválido"
    return row, (presion_arterial, frecuencia_cardiaca, oxigenacion_sangre), None


def _numero_fila(row: SignosBulkRow | None, raw_row, index: int) -> int:
    if row is not None and row.fila:
        return row.fila
    if isinstance(raw_row, dict) and str(raw_row.get("fila") or "").isdigit():
        return int(raw_row["fila"])
    return index


@router.post("/bulk/preview", response_model=SignosBulkPreviewResponse)
async def revisar_signos_bulk(
    bulk_request: SignosBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revisión previa (no guarda nada): ver app/revision.py."""
    personas = (await db.execute(select(Persona))).scalars().all()
    validas: list[tuple[int, SignosBulkRow]] = []
    invalidas: list[FilaInvalida] = []
    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, _, error = _parsear_fila(raw_row)
        fila = _numero_fila(row, raw_row, index)
        if error:
            invalidas.append(FilaInvalida(fila=fila, error=error))
        else:
            validas.append((fila, row))
    return SignosBulkPreviewResponse(
        total_filas=len(bulk_request.rows),
        identificadores=revisar_filas(validas, personas),
        invalidas=invalidas,
    )


@router.post("/bulk", response_model=SignosBulkResponse, status_code=201)
async def cargar_signos_bulk(
    bulk_request: SignosBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ok_count = 0
    errores: list[str] = []

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, valores, error = _parsear_fila(raw_row)
        fila = _numero_fila(row, raw_row, index)
        if error:
            errores.append(f"Fila {fila}: {error}")
            continue
        presion_arterial, frecuencia_cardiaca, oxigenacion_sangre = valores

        persona, error_persona = await persona_de_fila(row, db)
        if error_persona:
            errores.append(f"Fila {fila}: {error_persona}")
            continue

        operativo_id = row.operativo_id if row.operativo_id is not None else bulk_request.operativo_id
        lugar_custom = row.lugar_custom if row.lugar_custom is not None else bulk_request.lugar_custom
        try:
            operativo = await _resolve_operativo(operativo_id, lugar_custom, db)
        except HTTPException as exc:
            errores.append(f"Fila {fila}: {exc.detail}")
            continue

        duplicate_res = await db.execute(
            select(RegistroSignosVitales).where(
                and_(
                    RegistroSignosVitales.persona_id == persona.id,
                    RegistroSignosVitales.fecha == row.fecha,
                    RegistroSignosVitales.presion_arterial == presion_arterial,
                    RegistroSignosVitales.frecuencia_cardiaca == frecuencia_cardiaca,
                    RegistroSignosVitales.oxigenacion_sangre == oxigenacion_sangre,
                )
            )
        )
        if duplicate_res.scalars().first():
            errores.append(
                f"Fila {fila}: registro duplicado para persona {persona.nombre} {persona.apellido} en fecha {row.fecha}"
            )
            continue

        registro = RegistroSignosVitales(
            persona_id=persona.id,
            operativo_id=operativo.id,
            fecha=row.fecha,
            hora=datetime.now().time().replace(microsecond=0),
            presion_arterial=presion_arterial,
            frecuencia_cardiaca=frecuencia_cardiaca,
            oxigenacion_sangre=oxigenacion_sangre,
        )
        db.add(registro)
        await db.flush()
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "errores": errores}


@router.get("/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_signos(
    q: str | None = None,
    persona_id: int | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    db: AsyncSession = Depends(get_session),
):
    consulta = select(RegistroSignosVitales).options(
        selectinload(RegistroSignosVitales.persona), selectinload(RegistroSignosVitales.operativo)
    )
    if q:
        filtro = f"%{q}%"
        consulta = consulta.join(Persona).where(
            or_(Persona.dni == q, Persona.nombre.ilike(filtro), Persona.apellido.ilike(filtro))
        )
    if persona_id is not None:
        consulta = consulta.where(RegistroSignosVitales.persona_id == persona_id)
    if desde:
        consulta = consulta.where(RegistroSignosVitales.fecha >= desde)
    if hasta:
        consulta = consulta.where(RegistroSignosVitales.fecha <= hasta)
    consulta = consulta.order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    resultado = await db.execute(consulta)
    return resultado.scalars().all()