from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import require_admin
from ..database import get_session
from ..models import Persona
from ..reporte_pdf import KitPDF, PersonaPDF, RegistroPDF, generar_pdf

router = APIRouter(prefix="/reportes", tags=["reportes"])

# Nombre fijo a propósito: al subirlo a Drive siempre se reemplaza el mismo archivo.
NOMBRE_PDF = "SISVAP_signos_vitales.pdf"


class PedidoPdf(BaseModel):
    persona_ids: list[int] = Field(min_length=1)
    desde: date
    hasta: date


@router.post("/signos-vitales.pdf", dependencies=[Depends(require_admin)])
async def exportar_pdf_signos(pedido: PedidoPdf, db: AsyncSession = Depends(get_session)):
    """PDF con una hoja apaisada por persona elegida, con los signos y kits del período."""
    if pedido.desde > pedido.hasta:
        raise HTTPException(status_code=400, detail="La fecha 'desde' es posterior a 'hasta'.")
    resultado = await db.execute(
        select(Persona)
        .where(Persona.id.in_(pedido.persona_ids))
        .options(selectinload(Persona.registros), selectinload(Persona.kits))
    )
    personas = [
        PersonaPDF(
            nombre=p.nombre,
            apellido=p.apellido,
            fecha_nacimiento=p.fecha_nacimiento,
            registros=[
                RegistroPDF(r.fecha, r.presion_arterial, r.frecuencia_cardiaca, r.oxigenacion_sangre)
                for r in p.registros
            ],
            kits=[KitPDF(k.tipo, k.fecha_entrega) for k in p.kits],
        )
        for p in resultado.scalars().all()
    ]
    pdf = await run_in_threadpool(generar_pdf, personas, pedido.desde, pedido.hasta)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{NOMBRE_PDF}"',
            "Cache-Control": "no-store",
        },
    )
