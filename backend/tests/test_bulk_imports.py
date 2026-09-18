import asyncio
from datetime import time

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, init_db
from app.models import Operativo, Persona, RegistroSignosVitales
from app.routers.personas import cargar_personas_bulk
from app.routers.signos import cargar_signos_bulk
from app.schemas import PersonaBulkRequest, SignosBulkRequest


async def reset_db():
    await init_db()
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RegistroSignosVitales))
        await session.execute(delete(Persona))
        await session.execute(delete(Operativo))
        await session.commit()


def test_personas_bulk_handles_duplicates_and_invalid_rows():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            result = await cargar_personas_bulk(
                PersonaBulkRequest(
                    rows=[
                        {"nombre": "Juan", "apellido": "Pérez", "dni": "12345678", "genero": "Masculino"},
                        {"nombre": "juan", "apellido": "perez", "dni": "12345678", "genero": "Masculino"},
                        {"nombre": "Ana", "apellido": "García", "dni": "87654321", "genero": "Femenino"},
                    ]
                ),
                db=session,
            )

            assert result["ok"] == 2
            assert any("ya existe" in error.lower() or "duplicada" in error.lower() for error in result["errores"])

    asyncio.run(_run())


def test_personas_bulk_uses_default_value_for_empty_dni():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            result = await cargar_personas_bulk(
                PersonaBulkRequest(
                    rows=[
                        {"nombre": "", "apellido": "", "dni": "", "genero": "Masculino"},
                        {"nombre": "", "apellido": "", "dni": "", "genero": "Femenino"},
                    ]
                ),
                db=session,
            )

            assert result["ok"] == 2
            assert not any("string should match pattern" in error.lower() for error in result["errores"])
            assert not any("ya existe" in error.lower() for error in result["errores"])
            rows = (await session.execute(select(Persona))).scalars().all()
            assert {persona.dni for persona in rows} == {"90000001", "90000002"}

    asyncio.run(_run())


def test_bulk_signos_accepts_excel_local_dates():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
            session.add(Persona(nombre="Juan", apellido="Pérez", dni="12345678"))
            await session.commit()

            result = await cargar_signos_bulk(
                SignosBulkRequest(
                    rows=[
                        {"identificador": "juan perez", "signos": "120/80-75-98.5", "fecha": "04/06/2026"},
                    ]
                ),
                user={"username": "voluntario", "role": "voluntario"},
                db=session,
            )

            assert result["ok"] == 1
            assert not result["errores"]

    asyncio.run(_run())


def test_bulk_signos_matches_case_insensitive_and_reports_missing_personas():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
            session.add(Persona(nombre="Juan", apellido="Pérez", dni="12345678"))
            await session.commit()

            result = await cargar_signos_bulk(
                SignosBulkRequest(
                    rows=[
                        {"identificador": "juan perez", "signos": "120/80-75-98.5", "fecha": "2026-06-04"},
                        {"identificador": "Pedro Gomez", "signos": "110/70-80-97", "fecha": "2026-06-04"},
                    ]
                ),
                user={"username": "voluntario", "role": "voluntario"},
                db=session,
            )

            assert result["ok"] == 1
            assert any("persona no encontrada" in error.lower() for error in result["errores"])

    asyncio.run(_run())
