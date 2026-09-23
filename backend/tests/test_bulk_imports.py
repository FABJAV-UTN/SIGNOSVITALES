import asyncio
from datetime import date, time

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


def test_bulk_signos_acepta_fechas_formato_eeuu_y_argentino():
    """Fechas como las que devuelve un Excel con formato mm-dd-yy (ej. '8/27/26')."""
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
            session.add(Persona(nombre="Juan", apellido="Pérez", dni="12345678"))
            await session.commit()

            result = await cargar_signos_bulk(
                SignosBulkRequest(
                    rows=[
                        {"identificador": "12345678", "signos": "120/80-75-98", "fecha": "8/27/26"},
                        {"identificador": "12345678", "signos": "120/80-75-97", "fecha": "27/08/2026"},
                        {"identificador": "12345678", "signos": "120/80-75-96", "fecha": 46261},
                    ]
                ),
                user={"username": "voluntario", "role": "voluntario"},
                db=session,
            )

            assert result["ok"] == 3, result["errores"]
            fechas = {r.fecha for r in (await session.execute(select(RegistroSignosVitales))).scalars().all()}
            assert fechas == {date(2026, 8, 27)}

    asyncio.run(_run())


def test_bulk_signos_fecha_invalida_solo_descarta_esa_fila():
    """Una fecha inválida no debe tirar abajo todo el archivo (antes: 422 para todo el request)."""
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
            session.add(Persona(nombre="Juan", apellido="Pérez", dni="12345678"))
            await session.commit()

            # Construir el request NO debe lanzar ValidationError.
            request = SignosBulkRequest(
                rows=[
                    {"identificador": "12345678", "signos": "120/80-75-98", "fecha": "2026-27-08"},
                    {"identificador": "12345678", "signos": "120/80-75-98", "fecha": "2026-08-27"},
                ]
            )
            result = await cargar_signos_bulk(request, user={"username": "voluntario", "role": "voluntario"}, db=session)

            assert result["ok"] == 1
            assert len(result["errores"]) == 1
            assert "Fila 1" in result["errores"][0]
            assert "fecha inválida" in result["errores"][0]

    asyncio.run(_run())


def test_bulk_signos_endpoint_http_no_devuelve_422_por_una_fecha():
    from fastapi.testclient import TestClient

    from app.auth import get_current_user
    from app.main import app

    async def _seed():
        await reset_db()
        async with AsyncSessionLocal() as session:
            session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
            session.add(Persona(nombre="Juan", apellido="Pérez", dni="12345678"))
            await session.commit()

    asyncio.run(_seed())
    app.dependency_overrides[get_current_user] = lambda: {"username": "voluntario", "role": "voluntario"}
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/signos/bulk",
                json={
                    "rows": [
                        {"identificador": "12345678", "signos": "120/80-75-98", "fecha": "2026-27-08"},
                        {"identificador": "12345678", "signos": "120/80-75-98", "fecha": "2026-08-27"},
                    ]
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201, response.text
    assert response.json()["ok"] == 1


def test_personas_bulk_fecha_nacimiento_invalida_solo_descarta_esa_fila():
    async def _run():
        await reset_db()
        async with AsyncSessionLocal() as session:
            result = await cargar_personas_bulk(
                PersonaBulkRequest(
                    rows=[
                        {"nombre": "Juan", "apellido": "Pérez", "dni": "12345678", "fecha_nacimiento": "1990-13-40"},
                        {"nombre": "Ana", "apellido": "García", "dni": "87654321", "fecha_nacimiento": "5/14/90"},
                    ]
                ),
                db=session,
            )

            assert result["ok"] == 1
            assert any("fecha inválida" in e for e in result["errores"])
            ana = (await session.execute(select(Persona).where(Persona.dni == "87654321"))).scalar_one()
            assert ana.fecha_nacimiento == date(1990, 5, 14)

    asyncio.run(_run())
