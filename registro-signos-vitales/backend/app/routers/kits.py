from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Kit, Persona
from ..schemas import KitCreate, KitRead

router = APIRouter(prefix="/kits", tags=["kits"])


@router.post("", response_model=KitRead, status_code=201)
async def entregar_kit(kit_in: KitCreate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    persona_res = await db.execute(select(Persona).where(Persona.dni == kit_in.dni))
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


@router.get("/entregas", response_model=list[KitRead], dependencies=[Depends(require_admin)])
async def listar_entregas(db: AsyncSession = Depends(get_session)):
    consulta = select(Kit).options(selectinload(Kit.persona)).order_by(Kit.fecha_entrega.desc())
    resultado = await db.execute(consulta)
    return resultado.scalars().all()