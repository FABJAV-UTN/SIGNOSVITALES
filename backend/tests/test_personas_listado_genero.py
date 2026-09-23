import asyncio
from datetime import date, time

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, select, text

from app.database import AsyncSessionLocal, engine, init_db
from app.migrations import run_data_migrations
from app.models import Kit, Operativo, Persona, RegistroSignosVitales
from app.routers.personas import listar_personas
from app.schemas import PersonaCreate, normalize_genero


async def reset_db():
    await init_db()
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Kit))
        await session.execute(delete(RegistroSignosVitales))
        await session.execute(delete(Persona))
        await session.execute(delete(Operativo))
        await session.commit()
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS app_data_migrations"))


@pytest.mark.parametrize(
    "entrada,esperado",
    [("V", "V"), ("varón", "V"), ("Masculino", "V"), ("M", "M"), ("mujer", "M"), ("F", "M"),
     ("No binario", "No binario"), ("nb", "No binario"), ("", None), (None, None)],
)
def test_normalize_genero(entrada, esperado):
    assert normalize_genero(entrada) == esperado


def test_persona_create_rechaza_genero_invalido():
    with pytest.raises(ValidationError):
        PersonaCreate(nombre="Juan", apellido="Pérez", dni="12345678", genero="otro valor")


def test_migracion_genero_se_aplica_una_sola_vez():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add_all([
                Persona(nombre="Ramón", apellido="Reta", dni="11111111", genero="M"),
                Persona(nombre="Carina", apellido="Retamales", dni="22222222", genero="F"),
                Persona(nombre="Claudio", apellido="Sepulveda", dni="33333333", genero="Masculino"),
            ])
            await session.commit()

        await run_data_migrations(engine)
        await run_data_migrations(engine)  # segunda vez: no debe volver a convertir 'M' (mujer) en 'V'

        async with AsyncSessionLocal() as session:
            generos = {p.dni: p.genero for p in (await session.execute(select(Persona))).scalars()}
        assert generos == {"11111111": "V", "22222222": "M", "33333333": "V"}

    asyncio.run(_run())


def test_listado_incluye_totales_y_busca_sin_tildes():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            op = Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True)
            juan = Persona(nombre="Juan", apellido="Pérez", dni="27763284", genero="V")
            ana = Persona(nombre="Ana", apellido="Gómez", dni="30111222", genero="M")
            session.add_all([op, juan, ana])
            await session.flush()
            session.add_all([
                RegistroSignosVitales(persona_id=juan.id, operativo_id=op.id, fecha=date(2026, 5, 14),
                                      hora=time(20, 0), presion_arterial="120/80"),
                RegistroSignosVitales(persona_id=juan.id, operativo_id=op.id, fecha=date(2026, 6, 4),
                                      hora=time(20, 0), presion_arterial="130/80"),
                Kit(persona_id=juan.id, tipo="ABRIGO", fecha_entrega=date(2026, 6, 4)),
            ])
            await session.commit()

            todos = await listar_personas(q=None, limit=None, db=session)
            por_dni = {p.dni: p for p in todos}
            assert (por_dni["27763284"].total_signos, por_dni["27763284"].total_kits) == (2, 1)
            assert (por_dni["30111222"].total_signos, por_dni["30111222"].total_kits) == (0, 0)

            assert [p.dni for p in await listar_personas(q="juan perez", limit=None, db=session)] == ["27763284"]
            assert [p.dni for p in await listar_personas(q="GOMEZ", limit=None, db=session)] == ["30111222"]
            assert [p.dni for p in await listar_personas(q="2776", limit=None, db=session)] == ["27763284"]
            assert len(await listar_personas(q=None, limit=1, db=session)) == 1

    asyncio.run(_run())
