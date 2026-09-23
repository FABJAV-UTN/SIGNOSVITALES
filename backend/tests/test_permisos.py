import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def token(client, usuario, clave):
    r = client.post("/api/auth/login", json={"username": usuario, "password": clave})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.parametrize(
    "metodo,ruta",
    [
        ("get", "/api/personas"),
        ("get", "/api/personas/12345678"),
        ("post", "/api/personas"),
        ("post", "/api/signos"),
        ("get", "/api/kits/entregas"),
        ("get", "/api/signos/historial"),
    ],
)
def test_sin_login_no_se_accede(client, metodo, ruta):
    r = getattr(client, metodo)(ruta, json={}) if metodo == "post" else client.get(ruta)
    assert r.status_code == 401


def test_login_usa_las_claves_del_entorno(client):
    assert client.post("/api/auth/login", json={"username": "admin", "password": "admin2024"}).status_code == 401
    token(client, "admin", "admin-de-prueba")


def test_voluntario_no_ve_historial_de_signos(client):
    h = token(client, "voluntario", "voluntario-de-prueba")
    assert client.get("/api/personas", headers=h).status_code == 200
    assert client.get("/api/signos/historial", headers=h).status_code == 403


def test_admin_ve_historial_de_signos(client):
    h = token(client, "admin", "admin-de-prueba")
    assert client.get("/api/signos/historial", headers=h).status_code == 200
