import asyncio
from datetime import date, time

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, init_db
from app.models import Kit, Operativo, Persona, RegistroSignosVitales
from app.routers.personas import cargar_personas_bulk
from app.routers.signos import cargar_signos_bulk, revisar_signos_bulk
from app.schemas import PersonaBulkRequest, SignosBulkRequest

USER = {"username": "voluntario", "role": "voluntario"}


async def seed(session):
    await init_db()
    for model in (Kit, RegistroSignosVitales, Persona, Operativo):
        await session.execute(delete(model))
    session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
    session.add_all([
        Persona(nombre="Sulma", apellido="Sanchez", dni="65567713"),
        Persona(nombre="Magda", apellido="Bayon", dni="15620044"),
        Persona(nombre="Milena", apellido="Bayón", dni="39241851"),
        Persona(nombre="Pamela", apellido="Morales", dni="32931637"),
        Persona(nombre="Xiomara", apellido="Basualdo", dni="57721323"),
    ])
    await session.commit()


def fila(identificador, n, fecha="2026-09-10"):
    return {"identificador": identificador, "signos": "120/80-75-97", "fecha": fecha, "fila": n}


def test_preview_clasifica_exactas_sugerencias_y_no_encontradas():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session)
            res = await revisar_signos_bulk(
                SignosBulkRequest(rows=[
                    fila("Pamela Morales", 1),
                    fila("Zulma Sanchez", 2),
                    fila("zulma sánchez", 3, "2026-08-27"),
                    fila("Magdalena Bayón", 4),
                    fila("Xiomara", 5),
                    fila("Marcelo Tercero", 6),
                    fila("Marelo Tercero", 7),
                    {"identificador": "Josue", "signos": "", "fecha": "2026-13-45", "fila": 8},
                ]),
                user=USER,
                db=session,
            )
            por_id = {r.identificador: r for r in res.identificadores}
            assert por_id["Pamela Morales"].estado == "exacta"
            zulma = por_id["Zulma Sanchez"]
            assert zulma.estado == "sugerencia" and zulma.filas == [2, 3]
            assert zulma.candidatos[0].dni == "65567713"
            assert {c.dni for c in por_id["Magdalena Bayón"].candidatos} >= {"15620044"}
            assert por_id["Xiomara"].estado == "sugerencia"
            assert por_id["Marcelo Tercero"].estado == "no_encontrada"
            assert por_id["Marelo Tercero"].parecido_a == "Marcelo Tercero"
            assert [i.fila for i in res.invalidas] == [8]
            # La revisión no guarda nada.
            assert (await session.execute(select(RegistroSignosVitales))).scalars().all() == []

    asyncio.run(_run())


def test_carga_con_persona_id_confirmado_y_persona_creada():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session)
            sulma = (await session.execute(select(Persona).where(Persona.dni == "65567713"))).scalar_one()

            creadas = await cargar_personas_bulk(
                PersonaBulkRequest(rows=[{"nombre": "Marcelo", "apellido": "Tercero", "dni": ""}]), db=session
            )
            assert creadas["ok"] == 1
            marcelo = creadas["creadas"][0]
            assert marcelo["dni"].startswith("9")

            res = await cargar_signos_bulk(
                SignosBulkRequest(rows=[
                    {**fila("Zulma Sanchez", 2), "persona_id": sulma.id},
                    {**fila("Marcelo Tercero", 6), "persona_id": marcelo["id"]},
                    {**fila("Marelo Tercero", 7, "2026-08-27"), "persona_id": marcelo["id"]},
                    fila("Nadie Existe", 9),
                ]),
                user=USER,
                db=session,
            )
            assert res["ok"] == 3
            assert res["errores"] == ["Fila 9: persona no encontrada para 'Nadie Existe'"]
            registros = (await session.execute(select(RegistroSignosVitales))).scalars().all()
            assert sorted(r.persona_id for r in registros) == sorted([sulma.id, marcelo["id"], marcelo["id"]])
            assert {r.fecha for r in registros} == {date(2026, 9, 10), date(2026, 8, 27)}

    asyncio.run(_run())


def test_dni_provisorio_no_se_repite_entre_cargas():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session)
            a = await cargar_personas_bulk(PersonaBulkRequest(rows=[{"nombre": "Ana", "apellido": "Uno", "dni": ""}]), db=session)
            b = await cargar_personas_bulk(PersonaBulkRequest(rows=[{"nombre": "Beto", "apellido": "Dos", "dni": ""}]), db=session)
            assert a["ok"] == 1 and b["ok"] == 1, (a, b)
            assert a["creadas"][0]["dni"] != b["creadas"][0]["dni"]

    asyncio.run(_run())
