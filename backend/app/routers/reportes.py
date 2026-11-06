from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import require_admin
from ..database import get_session
from ..models import Kit, Operativo, Persona, RegistroSignosVitales
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


@router.get("/conteo", dependencies=[Depends(require_admin)])
async def conteo_beneficiarios(
    desde: date | None = None,
    hasta: date | None = None,
    incluir_signos: bool = True,
    incluir_kits: bool = True,
    modo: str = "personas",
    db: AsyncSession = Depends(get_session),
):
    """Conteo del período.

    modo="personas": personas distintas (cada una una sola vez en el período).
    modo="atenciones": una por persona y por día (si vino 4 jueves, cuenta 4).
    incluir_signos / incluir_kits: qué cuenta como "atendida".
    También devuelve el desglose por día, para comparar con las planillas.
    """
    if desde and hasta and desde > hasta:
        raise HTTPException(status_code=400, detail="La fecha 'desde' es posterior a 'hasta'.")
    if modo not in ("personas", "atenciones"):
        raise HTTPException(status_code=400, detail="modo tiene que ser 'personas' o 'atenciones'.")

    # (persona, fecha, lugar) de cada atención según lo elegido.
    partes = []
    if incluir_signos:
        q = (
            select(
                RegistroSignosVitales.persona_id.label("persona_id"),
                RegistroSignosVitales.fecha.label("fecha"),
                Operativo.lugar.label("lugar"),
            )
            .join(Operativo, Operativo.id == RegistroSignosVitales.operativo_id)
        )
        if desde:
            q = q.where(RegistroSignosVitales.fecha >= desde)
        if hasta:
            q = q.where(RegistroSignosVitales.fecha <= hasta)
        partes.append(q)
    if incluir_kits:
        q = select(
            Kit.persona_id.label("persona_id"),
            Kit.fecha_entrega.label("fecha"),
            literal("Entrega de kits").label("lugar"),
        )
        if desde:
            q = q.where(Kit.fecha_entrega >= desde)
        if hasta:
            q = q.where(Kit.fecha_entrega <= hasta)
        partes.append(q)

    personas = {"mujeres": 0, "varones": 0, "no_binario": 0, "sin_dato": 0, "total": 0}
    por_dia: list[dict] = []
    if partes:
        atenciones = (union_all(*partes) if len(partes) > 1 else partes[0]).subquery()
        # Una fila por persona y día (si en el mismo día tuvo signos y kit, cuenta una vez).
        filas = (
            await db.execute(
                select(atenciones.c.persona_id, atenciones.c.fecha, atenciones.c.lugar, Persona.genero)
                .join(Persona, Persona.id == atenciones.c.persona_id)
            )
        ).all()
        por_persona_dia: dict[tuple, tuple] = {}
        for persona_id, fecha, lugar, genero in filas:
            clave = (persona_id, fecha)
            if clave not in por_persona_dia or por_persona_dia[clave][0] == "Entrega de kits":
                por_persona_dia[clave] = (lugar, genero)

        contados = set()
        dias: dict = {}
        for (persona_id, fecha), (lugar, genero) in por_persona_dia.items():
            g = _clave_genero(genero)
            unidad = persona_id if modo == "personas" else (persona_id, fecha)
            if unidad not in contados:
                contados.add(unidad)
                personas[g] += 1
                personas["total"] += 1
            dia = dias.setdefault(fecha, {"fecha": fecha, "lugares": set(), "mujeres": 0, "varones": 0, "no_binario": 0, "sin_dato": 0, "total": 0})
            dia["lugares"].add(lugar)
            dia[g] += 1
            dia["total"] += 1
        for fecha in sorted(dias):
            d = dias[fecha]
            d["lugares"] = ", ".join(sorted(d["lugares"]))
            por_dia.append(d)

    con_signos = con_kit = 0
    kits = {"higiene": 0, "abrigo": 0, "total": 0}
    q_tipos = select(Kit.tipo, func.count()).group_by(Kit.tipo)
    q_sig = select(func.count(func.distinct(RegistroSignosVitales.persona_id)))
    q_kit = select(func.count(func.distinct(Kit.persona_id)))
    if desde:
        q_tipos = q_tipos.where(Kit.fecha_entrega >= desde)
        q_sig = q_sig.where(RegistroSignosVitales.fecha >= desde)
        q_kit = q_kit.where(Kit.fecha_entrega >= desde)
    if hasta:
        q_tipos = q_tipos.where(Kit.fecha_entrega <= hasta)
        q_sig = q_sig.where(RegistroSignosVitales.fecha <= hasta)
        q_kit = q_kit.where(Kit.fecha_entrega <= hasta)
    con_signos = await db.scalar(q_sig) or 0
    con_kit = await db.scalar(q_kit) or 0
    for tipo, cantidad in (await db.execute(q_tipos)).all():
        if tipo == "PPAAS":
            kits["higiene"] += cantidad
        elif tipo == "ABRIGO":
            kits["abrigo"] += cantidad
    kits["total"] = kits["higiene"] + kits["abrigo"]

    return {
        "desde": desde,
        "hasta": hasta,
        "modo": modo,
        "incluir_signos": incluir_signos,
        "incluir_kits": incluir_kits,
        "personas": personas,
        "personas_con_signos": con_signos,
        "personas_con_kit": con_kit,
        "kits": kits,
        "por_dia": por_dia,
    }


def _clave_genero(genero: str | None) -> str:
    # OJO: en el sistema "M" es MUJER y "V" es varón.
    return {"M": "mujeres", "V": "varones", "No binario": "no_binario"}.get(genero, "sin_dato")
