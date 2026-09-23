"""Las pruebas SIEMPRE usan una base temporal.

Los tests vacían las tablas (reset_db). Sin esto, correr `pytest` usaría
backend/data/signos_vitales.db y borraría los datos reales.
Esta variable se define antes de que se importe app.database.
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="sisvap-tests-")
os.environ["SIGNOS_VITALES_DB_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"

# Credenciales de prueba (el backend no arranca sin ellas).
os.environ.setdefault("SISVAP_ADMIN_PASSWORD", "admin-de-prueba")
os.environ.setdefault("SISVAP_VOLUNTARIO_PASSWORD", "voluntario-de-prueba")
os.environ.setdefault("SISVAP_SECRET_KEY", "clave-de-prueba")
