"""DNI opcional y planillas con Nombre / Apellido / DNI / Fecha de nacimiento separados.

El caso que motivó el cambio: una planilla trae a "Juan Pérez" sin DNI (se crea sin DNI) y
otra planilla trae a la misma persona con DNI. La revisión tiene que reconocerla y permitir
completarle el DNI, en vez de tratarla como alguien nuevo.
"""

import asyncio
from datetime import date, time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.auth import get_current_user
from app.database import AsyncSessionLocal, init_db
from app.main import app
from app.models import Kit, Operativo, Persona, RegistroSignosVitales
from app.routers.kits import revisar_kits_bulk
from app.routers.personas import actualizar_datos_personas, revisar_personas_bulk
from app.routers.signos import revisar_signos_bulk
from app.schemas import ActualizacionesRequest, KitBulkRequest, PersonaBulkRequest, SignosBulkRequest

USER = {"username": "voluntario", "role": "voluntario"}


async def seed(session, *personas):
    await init_db()
    for model in (Kit, RegistroSignosVitales, Persona, Operativo):
        await session.execute(delete(model))
    session.add(Operativo(lugar="Museo Ferroviario", dia_semana="Jueves", hora=time(20, 30), activo=True))
    session.add_all(list(personas))
    await session.commit()


def signo(n, nombre=None, apellido=None, dni=None, nacimiento=None):
    return {
        "fila": n, "nombre": nombre, "apellido": apellido, "dni": dni, "fecha_nacimiento": nacimiento,
        "signos": "120/80-75-97", "fecha": "2026-09-10",
    }


def revisar(rows, persona_seed):
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session, *persona_seed())
            res = await revisar_signos_bulk(SignosBulkRequest(rows=rows), user=USER, db=session)
            ids = {p.nombre: p.id for p in (await session.execute(select(Persona))).scalars()}
            return res, ids

    return asyncio.run(_run())


def test_persona_cargada_sin_dni_se_reconoce_cuando_llega_con_dni():
    res, ids = revisar(
        [signo(2, "Juan", "Pérez", "30.123.456", "02/01/1980")],
        lambda: [Persona(nombre="Juan", apellido="Perez", dni=None)],
    )
    [item] = res.identificadores
    assert item.estado == "exacta"
    assert item.persona.id == ids["Juan"] and item.persona.dni is None
    # Lo que trae la planilla, para que el frontend ofrezca completarlo.
    assert item.dni == "30123456"
    assert item.fecha_nacimiento == date(1980, 1, 2)
    assert item.dni_en_uso_por is None


def test_dni_existente_es_esa_persona_aunque_no_haya_nombre():
    res, ids = revisar(
        [signo(2, dni="30123456"), signo(3, "Juancito", "Peres", "30123456")],
        lambda: [Persona(nombre="Juan", apellido="Pérez", dni="30123456")],
    )
    [item] = res.identificadores
    assert item.estado == "exacta" and item.persona.id == ids["Juan"]
    assert item.filas == [2, 3]


def test_dni_de_otra_persona_pide_confirmar():
    res, ids = revisar(
        [signo(2, "María", "López", "30123456")],
        lambda: [
            Persona(nombre="Juan", apellido="Pérez", dni="30123456"),
            Persona(nombre="María", apellido="López", dni=None),
        ],
    )
    [item] = res.identificadores
    assert item.estado == "conflicto_dni"
    assert item.dni_en_uso_por == ids["Juan"]
    assert [c.id for c in item.candidatos] == [ids["Juan"], ids["María"]]


def test_mismo_nombre_con_otro_dni_pide_confirmar():
    res, ids = revisar(
        [signo(2, "Juan", "Pérez", "40111222")],
        lambda: [Persona(nombre="Juan", apellido="Pérez", dni="30123456")],
    )
    [item] = res.identificadores
    assert item.estado == "conflicto_dni"
    assert [c.id for c in item.candidatos] == [ids["Juan"]]
    assert item.dni_en_uso_por is None


def test_misma_persona_con_y_sin_dni_en_el_archivo_es_un_solo_grupo():
    res, _ = revisar(
        [signo(2, "Ana", "Gómez"), signo(3, "ana", "gomez", "28999888"), signo(4, "Ana", "Gómez")],
        lambda: [],
    )
    [item] = res.identificadores
    assert item.estado == "no_encontrada"
    assert item.filas == [2, 3, 4]
    assert item.dni == "28999888"
    assert (item.nombre_sugerido, item.apellido_sugerido) == ("Ana", "Gómez")


def test_solo_dni_que_no_existe_queda_para_crear():
    res, _ = revisar([signo(2, dni="28999888")], lambda: [])
    [item] = res.identificadores
    assert item.estado == "no_encontrada" and item.identificador == "DNI 28999888"
    assert item.nombre_sugerido == "" and item.dni == "28999888"


def test_fila_sin_ningun_dato_de_persona_es_invalida():
    res, _ = revisar([signo(2), signo(3, "Ana", "Gómez")], lambda: [])
    assert [f.fila for f in res.invalidas] == [2]
    assert "falta la persona" in res.invalidas[0].error


def test_kits_usan_la_misma_revision_con_columnas_separadas():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session, Persona(nombre="Juan", apellido="Pérez", dni=None))
            res = await revisar_kits_bulk(
                KitBulkRequest(rows=[{"fila": 2, "nombre": "Juan", "apellido": "Pérez", "dni": "30123456",
                                      "tipo": "PPAAS", "fecha": "2026-09-10"}]),
                user=USER,
                db=session,
            )
            return res

    [item] = asyncio.run(_run()).identificadores
    assert item.estado == "exacta" and item.dni == "30123456"


def test_planilla_de_personas_pasa_por_la_revision():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(session, Persona(nombre="Juan", apellido="Pérez", dni=None))
            return await revisar_personas_bulk(
                PersonaBulkRequest(rows=[
                    {"fila": 2, "nombre": "Juan", "apellido": "Pérez", "dni": "30123456", "fecha_nacimiento": "1980-01-02"},
                    {"fila": 3, "nombre": "Nueva", "apellido": "Persona", "dni": "", "genero": "M"},
                    {"fila": 4, "nombre": "Mal", "apellido": "Genero", "genero": "zzz"},
                ]),
                user=USER,
                db=session,
            )

    res = asyncio.run(_run())
    estados = {r.identificador: r.estado for r in res.identificadores}
    assert estados == {"Juan Pérez · DNI 30123456": "exacta", "Nueva Persona": "no_encontrada"}
    assert [f.fila for f in res.invalidas] == [4]


def test_actualizar_completa_dni_y_fecha_y_no_pisa_dni_ajeno():
    async def _run():
        async with AsyncSessionLocal() as session:
            await seed(
                session,
                Persona(nombre="Juan", apellido="Pérez", dni=None),
                Persona(nombre="Otro", apellido="Señor", dni="40111222"),
            )
            juan = (await session.execute(select(Persona).where(Persona.nombre == "Juan"))).scalar_one()
            res = await actualizar_datos_personas(
                ActualizacionesRequest(cambios=[
                    {"persona_id": juan.id, "dni": "30.123.456", "fecha_nacimiento": "02/01/1980"},
                ]),
                user=USER,
                db=session,
            )
            assert res == {"ok": 1, "errores": []}
            res = await actualizar_datos_personas(
                ActualizacionesRequest(cambios=[{"persona_id": juan.id, "dni": "40111222"}]), user=USER, db=session
            )
            assert "ya lo tiene Otro Señor" in res["errores"][0]
            await session.refresh(juan)
            return juan.dni, juan.fecha_nacimiento

    assert asyncio.run(_run()) == ("30123456", date(1980, 1, 2))


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: USER
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def test_editar_persona_a_mano(client):
    async def _seed():
        async with AsyncSessionLocal() as session:
            await seed(
                session,
                Persona(nombre="Juan", apellido="Pérez", dni=None, fecha_nacimiento=date(1980, 1, 2)),
                Persona(nombre="Otro", apellido="Señor", dni="40111222"),
            )
            return {p.nombre: p.id for p in (await session.execute(select(Persona))).scalars()}

    ids = asyncio.run(_seed())
    url = f"/api/personas/{ids['Juan']}"

    r = client.patch(url, json={"dni": "30.123.456"})
    assert r.status_code == 200, r.text
    assert r.json()["dni"] == "30123456" and r.json()["fecha_nacimiento"] == "1980-01-02"

    r = client.patch(url, json={"fecha_nacimiento": None})
    assert r.json()["fecha_nacimiento"] is None and r.json()["dni"] == "30123456"

    r = client.patch(url, json={"dni": "40111222"})
    assert r.status_code == 400 and "Otro Señor" in r.json()["detail"]

    r = client.patch(url, json={"dni": ""})
    assert r.json()["dni"] is None

    assert client.get(url).json()["total_signos"] == 0


def test_crear_persona_sin_dni_y_registrar_signos_y_kit_por_id(client):
    asyncio.run(_reset())
    r = client.post("/api/personas", json={"nombre": "Sin", "apellido": "Documento"})
    assert r.status_code == 201, r.text
    persona = r.json()
    assert persona["dni"] is None

    r = client.post("/api/signos", json={"persona_id": persona["id"], "presion_arterial": "120/80"})
    assert r.status_code == 201, r.text
    r = client.post("/api/kits", json={"persona_id": persona["id"], "tipo": "PPAAS"})
    assert r.status_code == 201, r.text
    assert len(client.get(f"/api/kits/persona/{persona['id']}").json()) == 1

    # Se pueden crear varias personas sin DNI (no chocan en el índice único).
    assert client.post("/api/personas", json={"nombre": "Otra", "apellido": "Persona", "dni": ""}).status_code == 201


async def _reset():
    async with AsyncSessionLocal() as session:
        await seed(session)
