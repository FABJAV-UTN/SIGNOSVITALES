"""Migraciones de datos que se ejecutan UNA sola vez al arrancar el backend.

El proyecto crea las tablas con `Base.metadata.create_all` (no corre Alembic), así que
las correcciones de datos se registran en la tabla `app_data_migrations` para no
aplicarse dos veces. Esto es importante para el género: 'M' antes significaba
"masculino" y ahora significa "mujer", así que re-ejecutar la migración sería un error.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

# Valores viejos (texto libre) -> nuevo formato 'V' / 'M' / 'No binario'.
# En los datos anteriores convivían 'M' / 'F' / 'Masculino': ahí 'M' = masculino.
_GENERO_LEGACY = {
    "m": "V",
    "masculino": "V",
    "masc": "V",
    "hombre": "V",
    "h": "V",
    "varon": "V",
    "varón": "V",
    "v": "V",
    "f": "M",
    "femenino": "M",
    "fem": "M",
    "mujer": "M",
    "no binario": "No binario",
    "nb": "No binario",
    "x": "No binario",
}


async def _migrar_genero_v_m_nb(conn) -> None:
    rows = (await conn.execute(text("SELECT id, genero FROM personas WHERE genero IS NOT NULL"))).all()
    for persona_id, genero in rows:
        key = str(genero).strip().casefold()
        if not key:
            nuevo = None
        else:
            nuevo = _GENERO_LEGACY.get(key, genero)
        if nuevo != genero:
            await conn.execute(
                text("UPDATE personas SET genero = :g WHERE id = :id"), {"g": nuevo, "id": persona_id}
            )


MIGRACIONES = [
    ("0001_genero_v_m_nobinario", _migrar_genero_v_m_nb),
]


async def run_data_migrations(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS app_data_migrations ("
                "name VARCHAR(120) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        aplicadas = {row[0] for row in (await conn.execute(text("SELECT name FROM app_data_migrations"))).all()}
        for nombre, funcion in MIGRACIONES:
            if nombre in aplicadas:
                continue
            await funcion(conn)
            await conn.execute(text("INSERT INTO app_data_migrations (name) VALUES (:n)"), {"n": nombre})
