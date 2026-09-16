import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import require_admin
from ..database import get_session
from ..models import Operativo, Persona, RegistroSignosVitales
from ..schemas import PersonaCreate, PersonaRead, SignosRead

router = APIRouter(prefix="/personas", tags=["personas"])


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


@router.get("", response_model=list[PersonaRead])
async def listar_personas(q: str | None = Query(None, min_length=1), db: AsyncSession = Depends(get_session)):
    consulta = select(Persona)
    if q:
        filtro = f"%{q}%"
        dni_clean = re.sub(r"[\s.-]", "", q.strip())
        consulta = consulta.where(
            or_(Persona.dni == q, Persona.dni == dni_clean, Persona.nombre.ilike(filtro), Persona.apellido.ilike(filtro))
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
