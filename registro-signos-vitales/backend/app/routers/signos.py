from datetime import date, datetime, time
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Operativo, Persona, RegistroSignosVitales
from ..schemas import SignosBulkRequest, SignosBulkResponse, SignosBulkRow, SignosCreate, SignosRead

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


async def _find_persona_by_identificador(identifier: str, db: AsyncSession) -> Persona:
    identifier = identifier.strip()
    if re.fullmatch(r"^\d{7,8}$", identifier):
        persona_res = await db.execute(select(Persona).where(Persona.dni == identifier))
        return persona_res.scalar_one_or_none()

    if " " not in identifier:
        raise HTTPException(status_code=400, detail="El identificador debe ser DNI o Nombre y Apellido completos.")

    parts = [part.strip() for part in identifier.split(" ") if part.strip()]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="El identificador debe incluir Nombre y Apellido.")
    nombre = parts[0]
    apellido = parts[-1]
    persona_res = await db.execute(
        select(Persona).where(
            and_(Persona.nombre.ilike(nombre), Persona.apellido.ilike(apellido))
        )
    )
    personas = persona_res.scalars().all()
    if len(personas) > 1:
        raise HTTPException(status_code=400, detail="Identificador ambiguo: existe más de una persona con ese nombre y apellido.")
    return personas[0] if personas else None


@router.post("", response_model=SignosRead, status_code=201)
async def crear_signos(signos_in: SignosCreate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    persona_res = await db.execute(select(Persona).where(Persona.dni == signos_in.dni))
    persona = persona_res.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")

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


@router.post("/bulk", response_model=SignosBulkResponse, status_code=201)
async def cargar_signos_bulk(
    bulk_request: SignosBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ok_count = 0
    errores: list[str] = []

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        try:
            row = SignosBulkRow.model_validate(raw_row)
        except ValidationError as exc:
            detalles = ", ".join([error["msg"] for error in exc.errors()])
            errores.append(f"Fila {index}: datos inválidos ({detalles})")
            continue

        try:
            partes = [part.strip() for part in row.signos.split("-")]
            if len(partes) != 3:
                errores.append(f"Fila {index}: formato de signos inválido (esperado PA-FC-SpO2)")
                continue
            presion_arterial = partes[0] if partes[0] else None
            frecuencia_cardiaca = int(partes[1]) if partes[1] else None
            oxigenacion_sangre = float(partes[2]) if partes[2] else None
        except Exception:
            errores.append(f"Fila {index}: formato de signos inválido")
            continue

        try:
            persona = await _find_persona_by_identificador(row.identificador, db)
        except HTTPException as exc:
            errores.append(f"Fila {index}: {exc.detail}")
            continue

        if not persona:
            errores.append(f"Fila {index}: persona no encontrada para '{row.identificador}'")
            continue

        operativo_id = row.operativo_id if row.operativo_id is not None else bulk_request.operativo_id
        lugar_custom = row.lugar_custom if row.lugar_custom is not None else bulk_request.lugar_custom
        try:
            operativo = await _resolve_operativo(operativo_id, lugar_custom, db)
        except HTTPException as exc:
            errores.append(f"Fila {index}: {exc.detail}")
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
        duplicate = duplicate_res.scalar_one_or_none()
        if duplicate:
            errores.append(
                f"Fila {index}: registro duplicado para persona {persona.nombre} {persona.apellido} en fecha {row.fecha}"
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
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "errores": errores}


@router.get("/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_signos(
    q: str | None = None,
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
    if desde:
        consulta = consulta.where(RegistroSignosVitales.fecha >= desde)
    if hasta:
        consulta = consulta.where(RegistroSignosVitales.fecha <= hasta)
    consulta = consulta.order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    resultado = await db.execute(consulta)
    return resultado.scalars().all()