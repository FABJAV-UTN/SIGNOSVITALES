from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
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


@router.get("/signos-vitales.pdf", dependencies=[Depends(require_admin)])
async def exportar_pdf_signos(db: AsyncSession = Depends(get_session)):
    resultado = await db.execute(
        select(Persona).options(selectinload(Persona.registros), selectinload(Persona.kits))
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
    pdf = await run_in_threadpool(generar_pdf, personas)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{NOMBRE_PDF}"',
            "Cache-Control": "no-store",
        },
    )
