from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_session
from ..models import Operativo
from ..schemas import OperativoRead, OperativoUpdate

router = APIRouter(prefix="/operativo", tags=["operativo"])


@router.get("", response_model=OperativoRead)
async def obtener_operativo(db: AsyncSession = Depends(get_session)):
    consulta = await db.execute(select(Operativo).where(Operativo.activo.is_(True)))
    operativo = consulta.scalar_one_or_none()
    if not operativo:
        raise HTTPException(status_code=404, detail="Operativo activo no encontrado")
    return operativo


@router.put("", response_model=OperativoRead)
async def actualizar_operativo(
    payload: OperativoUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    consulta = await db.execute(select(Operativo).where(Operativo.activo.is_(True)))
    operativo = consulta.scalar_one_or_none()
    if operativo is None:
        operativo = Operativo(
            lugar=payload.lugar,
            dia_semana=payload.dia_semana,
            hora=payload.hora,
            activo=True,
        )
        db.add(operativo)
    else:
        operativo.lugar = payload.lugar
        operativo.dia_semana = payload.dia_semana
        operativo.hora = payload.hora
    await db.commit()
    await db.refresh(operativo)
    return operativo
