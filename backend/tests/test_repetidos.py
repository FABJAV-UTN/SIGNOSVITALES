"""Personas repetidas: detección por nombre parecido y unificación de registros."""

import asyncio
from datetime import date, time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.auth import require_admin
from app.database import AsyncSessionLocal, init_db
from app.main import app
from app.models import Kit, Operativo, Persona, PersonasDistintas, RegistroSignosVitales


async def _seed():
    await init_db()
    async with AsyncSessionLocal() as s:
        for model in (PersonasDistintas, Kit, RegistroSignosVitales, Persona, Operativo):
            await s.execute(delete(model))
        op = Operativo(lugar="Museo", dia_semana="Jueves", hora=time(20, 30), activo=True)
        personas = {
            "manu": Persona(nombre="Manu", apellido="", dni=None),
            "manuel": Persona(nombre="Manuel", apellido="", dni="30111222", fecha_nacimiento=date(1980, 1, 2)),
            "emanuel": Persona(nombre="Emanuel", apellido="Gonzalez", dni=None, genero="V"),
            "zulma": Persona(nombre="Zulma", apellido="Sanchez", dni="20111222"),
            "zulma2": Persona(nombre="Zulma", apellido="SinApellido3", dni=None),
            "juan1": Persona(nombre="Juan", apellido="Pérez", dni="11111111"),
            "juan2": Persona(nombre="Juan", apellido="Perez", dni="22222222"),
            "otro": Persona(nombre="Ramón", apellido="Reta", dni=None),
        }
        s.add(op)
        s.add_all(personas.values())
        await s.flush()
        ids = {k: p.id for k, p in personas.items()}
        reg = lambda pid, fecha, pa: RegistroSignosVitales(  # noqa: E731
            persona_id=pid, operativo_id=op.id, fecha=fecha, hora=time(20, 0), presion_arterial=pa,
            frecuencia_cardiaca=80, oxigenacion_sangre=97,
        )
        s.add_all([
            reg(ids["manu"], date(2026, 9, 1), "120/80"),
            reg(ids["manu"], date(2026, 9, 8), "130/80"),
            reg(ids["manuel"], date(2026, 9, 8), "130/80"),  # la misma medición cargada en los dos registros
            Kit(persona_id=ids["manu"], tipo="PPAAS", fecha_entrega=date(2026, 9, 1)),
        ])
        await s.commit()
        return ids


@pytest.fixture
def client():
    app.dependency_overrides[require_admin] = lambda: {"username": "admin", "role": "admin"}
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _grupos(client):
    r = client.get("/api/personas/repetidos")
    assert r.status_code == 200, r.text
    return [sorted(p["nombre"] + " " + p["apellido"] for p in g["personas"]) for g in r.json()], r.json()


def test_detecta_grupos_por_nombre_parecido(client):
    asyncio.run(_seed())
    nombres, grupos = _grupos(client)
    assert sorted(nombres) == [
        ["Emanuel Gonzalez", "Manu ", "Manuel "],  # Manu~Manuel y Manuel~Emanuel: un solo grupo
        ["Zulma Sanchez", "Zulma SinApellido3"],
    ]
    # Juan Pérez / Juan Perez tienen DNI distintos: no se proponen.
    grupo_manu = next(g for g in grupos if len(g["personas"]) == 3)
    sugerida = next(p for p in grupo_manu["personas"] if p["id"] == grupo_manu["sugerida_id"])
    assert sugerida["nombre"] == "Manuel"  # el que tiene DNI


def test_unificar_mueve_signos_y_kits_y_completa_datos(client):
    ids = asyncio.run(_seed())
    r = client.post("/api/personas/unificar", json={"conservar_id": ids["manu"], "unir_ids": [ids["manuel"]]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["persona"]["dni"] == "30111222" and res["persona"]["fecha_nacimiento"] == "1980-01-02"
    assert res["signos_movidos"] == 1 and res["duplicados_descartados"] == 1
    assert res["persona"]["total_signos"] == 2 and res["persona"]["total_kits"] == 1

    async def _check():
        async with AsyncSessionLocal() as s:
            assert await s.get(Persona, ids["manuel"]) is None
            assert await s.get(Persona, ids["emanuel"]) is not None

    asyncio.run(_check())

    # Emanuel quedó fuera (destildado) y se marca como distinto: ya no se propone con Manu.
    r = client.post("/api/personas/distintas", json={"pares": [[ids["manu"], ids["emanuel"]]]})
    assert r.json() == {"ok": 1}
    nombres, _ = _grupos(client)
    assert nombres == [["Zulma Sanchez", "Zulma SinApellido3"]]


def test_no_unifica_con_dni_distintos(client):
    ids = asyncio.run(_seed())
    r = client.post("/api/personas/unificar", json={"conservar_id": ids["juan1"], "unir_ids": [ids["juan2"]]})
    assert r.status_code == 400 and "DNI distintos" in r.json()["detail"]


def test_solo_admin(client):
    app.dependency_overrides.clear()
    assert client.get("/api/personas/repetidos").status_code == 401
