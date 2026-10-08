from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.reporte_pdf import KitPDF, PersonaPDF, RegistroPDF, calcular_edad, generar_pdf, resumen_kits


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _token(client, usuario, clave):
    r = client.post("/api/auth/login", json={"username": usuario, "password": clave})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


PEDIDO = {"persona_ids": [1, 2], "desde": "2026-09-01", "hasta": "2026-09-30"}


def test_pdf_solo_admin(client):
    assert client.post("/api/reportes/signos-vitales.pdf", json=PEDIDO).status_code == 401
    h = _token(client, "voluntario", "voluntario-de-prueba")
    assert client.post("/api/reportes/signos-vitales.pdf", json=PEDIDO, headers=h).status_code == 403


def test_pdf_pide_personas_y_rango_valido(client):
    h = _token(client, "admin", "admin-de-prueba")
    url = "/api/reportes/signos-vitales.pdf"
    assert client.post(url, json={**PEDIDO, "persona_ids": []}, headers=h).status_code == 422
    assert client.post(url, json={"persona_ids": [1]}, headers=h).status_code == 422
    assert client.post(url, json={**PEDIDO, "desde": "2026-10-01"}, headers=h).status_code == 400


def test_pdf_admin_descarga_con_nombre_fijo(client):
    h = _token(client, "admin", "admin-de-prueba")
    r = client.post("/api/reportes/signos-vitales.pdf", json=PEDIDO, headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert 'filename="SISVAP_signos_vitales.pdf"' in r.headers["content-disposition"]
    assert r.content.startswith(b"%PDF")


def test_generar_pdf_con_datos_y_sin_datos():
    personas = [
        PersonaPDF("Ana", "Pérez", date(1980, 5, 2), [
            RegistroPDF(date(2026, 8, 1), "120/80", 72, 97.0),
            RegistroPDF(date(2026, 9, 1), "0/0", 0, 0.0),  # carga masiva sin datos
            RegistroPDF(date(2026, 9, 15), "135/85", 88, 95.0),
        ], [KitPDF("PPAAS", date(2026, 8, 1)), KitPDF("PPAAS", date(2026, 9, 1)), KitPDF("ABRIGO", date(2026, 7, 1))]),
        PersonaPDF("Juan", "Gómez", None),
    ]
    desde, hasta = date(2026, 7, 1), date(2026, 9, 30)
    pdf = generar_pdf(personas, desde, hasta)
    assert pdf.startswith(b"%PDF")
    assert b"/Count 2" in pdf  # una hoja por persona
    assert generar_pdf([], desde, hasta).startswith(b"%PDF")


def test_edad_y_resumen_kits():
    assert calcular_edad(date(1980, 10, 9), date(2026, 10, 8)) == 45
    assert calcular_edad(date(1980, 10, 8), date(2026, 10, 8)) == 46
    assert calcular_edad(None, date(2026, 10, 8)) is None
    assert resumen_kits([]) == "ninguno"
    assert resumen_kits([KitPDF("PPAAS", date(2026, 9, 1)), KitPDF("PPAAS", date(2026, 8, 1))]) == "PPAAS × 2 (01/08/2026, 01/09/2026)"
