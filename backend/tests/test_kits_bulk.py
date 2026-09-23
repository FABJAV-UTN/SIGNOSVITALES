import asyncio
from datetime import date, time

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, init_db
from app.models import Kit, Operativo, Persona, RegistroSignosVitales
from app.routers.kits import cargar_kits_bulk, revisar_kits_bulk
from app.schemas import KitBulkRequest

USER = {"username": "voluntario", "role": "voluntario"}


async def seed(session):
    await init_db()
    for model in (Kit, RegistroSignosVitales, Persona, Operativo):
        await session.execute(delete(model))
    session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
    session.add_all([
        Persona(nombre="Sulma", apellido="Sanchez", dni="65567713"),
        Persona(nombre="Pamela", apellido="Morales", dni="32931637"),
    ])
    await session.commit()


def test_preview_kits_usa_la_misma_revision():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session)
            res = await revisar_kits_bulk(
                KitBulkRequest(rows=[
                    {"fila": 2, "identificador": "Pamela Morales", "tipo": "abrigo", "fecha": "2026-06-04"},
                    {"fila": 3, "identificador": "Zulma Sanchez", "tipo": "Kit PPAAS", "fecha": "04/06/2026"},
                    {"fila": 4, "identificador": "Marcelo Tercero", "tipo": "PPAAS", "fecha": "2026-06-04"},
                    {"fila": 5, "identificador": "32931637", "tipo": "zapatillas", "fecha": "2026-06-04"},
                ]),
                user=USER,
                db=session,
            )
            estados = {r.identificador: r.estado for r in res.identificadores}
            assert estados == {"Pamela Morales": "exacta", "Zulma Sanchez": "sugerencia", "Marcelo Tercero": "no_encontrada"}
            assert [i.fila for i in res.invalidas] == [5]
            assert "tipo de kit" in res.invalidas[0].error

    asyncio.run(_run())


def test_carga_kits_con_persona_id_y_duplicados():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session)
            sulma = (await session.execute(select(Persona).where(Persona.dni == "65567713"))).scalar_one()
            filas = [
                {"fila": 2, "identificador": "Pamela Morales", "tipo": "ABRIGO", "fecha": "2026-06-04"},
                {"fila": 3, "identificador": "Zulma Sanchez", "tipo": "PPAAS", "fecha": "2026-06-04", "persona_id": sulma.id},
                {"fila": 4, "identificador": "Pamela Morales", "tipo": "ABRIGO", "fecha": "2026-06-04"},
            ]
            res = await cargar_kits_bulk(KitBulkRequest(rows=filas), user=USER, db=session)
            assert res["ok"] == 2
            assert len(res["errores"]) == 1 and res["errores"][0].startswith("Fila 4: entrega duplicada")
            kits = (await session.execute(select(Kit))).scalars().all()
            assert {(k.persona_id == sulma.id, k.tipo, k.fecha_entrega) for k in kits} == {
                (False, "ABRIGO", date(2026, 6, 4)),
                (True, "PPAAS", date(2026, 6, 4)),
            }

    asyncio.run(_run())
