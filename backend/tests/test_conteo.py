import asyncio
from datetime import date, time

from sqlalchemy import delete

from app.database import AsyncSessionLocal, init_db
from app.models import Kit, Operativo, Persona, RegistroSignosVitales
from app.routers.reportes import conteo_beneficiarios


async def _preparar():
    await init_db()
    async with AsyncSessionLocal() as s:
        for modelo in (Kit, RegistroSignosVitales, Persona, Operativo):
            await s.execute(delete(modelo))
        op = Operativo(lugar="Museo", dia_semana="Jueves", hora=time(20, 30), activo=True)
        ana = Persona(nombre="Ana", apellido="A", genero="M")      # mujer
        beto = Persona(nombre="Beto", apellido="B", genero="V")   # varón
        caro = Persona(nombre="Caro", apellido="C", genero="M")   # mujer, solo kit
        dani = Persona(nombre="Dani", apellido="D")               # sin género
        eva = Persona(nombre="Eva", apellido="E", genero="M")     # fuera del período
        s.add_all([op, ana, beto, caro, dani, eva])
        await s.flush()
        sep = date(2026, 9, 10)
        s.add_all([
            # Ana se atiende dos veces: cuenta una sola persona
            RegistroSignosVitales(persona_id=ana.id, operativo_id=op.id, fecha=sep, frecuencia_cardiaca=80),
            RegistroSignosVitales(persona_id=ana.id, operativo_id=op.id, fecha=date(2026, 9, 17), frecuencia_cardiaca=82),
            RegistroSignosVitales(persona_id=beto.id, operativo_id=op.id, fecha=sep, frecuencia_cardiaca=70),
            RegistroSignosVitales(persona_id=dani.id, operativo_id=op.id, fecha=sep, frecuencia_cardiaca=70),
            RegistroSignosVitales(persona_id=eva.id, operativo_id=op.id, fecha=date(2026, 10, 1), frecuencia_cardiaca=70),
            Kit(persona_id=ana.id, tipo="ABRIGO", fecha_entrega=sep),
            Kit(persona_id=ana.id, tipo="PPAAS", fecha_entrega=sep),
            Kit(persona_id=caro.id, tipo="PPAAS", fecha_entrega=sep),
            Kit(persona_id=eva.id, tipo="ABRIGO", fecha_entrega=date(2026, 10, 1)),
        ])
        await s.commit()


def _conteo(desde=None, hasta=None):
    async def run():
        async with AsyncSessionLocal() as s:
            return await conteo_beneficiarios(desde=desde, hasta=hasta, db=s)
    return asyncio.run(run())


def test_conteo_periodo():
    asyncio.run(_preparar())
    r = _conteo(date(2026, 9, 1), date(2026, 9, 30))
    assert r["personas"] == {"mujeres": 2, "varones": 1, "no_binario": 0, "sin_dato": 1, "total": 4}
    assert r["personas_con_signos"] == 3
    assert r["personas_con_kit"] == 2
    assert r["kits"] == {"higiene": 2, "abrigo": 1, "total": 3}


def test_conteo_sin_fechas_cuenta_todo():
    asyncio.run(_preparar())
    r = _conteo()
    assert r["personas"]["total"] == 5
    assert r["personas"]["mujeres"] == 3
    assert r["kits"] == {"higiene": 2, "abrigo": 2, "total": 4}


def test_conteo_atenciones_y_opciones():
    asyncio.run(_preparar())
    async def run(**kw):
        async with AsyncSessionLocal() as s:
            return await conteo_beneficiarios(desde=date(2026, 9, 1), hasta=date(2026, 9, 30), db=s, **kw)
    # Ana vino 2 días (10 y 17): en atenciones cuenta 2; su kit del 10 no suma otra.
    r = asyncio.run(run(modo="atenciones", incluir_signos=True, incluir_kits=True))
    assert r["personas"]["total"] == 5
    assert r["personas"]["mujeres"] == 3
    # Sin kits: Caro (solo kit) no cuenta.
    r = asyncio.run(run(modo="personas", incluir_signos=True, incluir_kits=False))
    assert r["personas"]["total"] == 3
    # Solo kits.
    r = asyncio.run(run(modo="personas", incluir_signos=False, incluir_kits=True))
    assert r["personas"]["total"] == 2
    # Desglose por día.
    r = asyncio.run(run(modo="personas", incluir_signos=True, incluir_kits=True))
    dias = {d["fecha"]: d for d in r["por_dia"]}
    assert dias[date(2026, 9, 10)]["total"] == 4
    assert dias[date(2026, 9, 17)]["total"] == 1
    assert dias[date(2026, 9, 10)]["lugares"] == "Entrega de kits, Museo"
