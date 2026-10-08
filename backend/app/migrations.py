"""Migraciones de datos que se ejecutan UNA sola vez al arrancar el backend.

El proyecto crea las tablas con `Base.metadata.create_all` (no corre Alembic), así que
las correcciones de datos se registran en la tabla `app_data_migrations` para no
aplicarse dos veces. Esto es importante para el género: 'M' antes significaba
"masculino" y ahora significa "mujer", así que re-ejecutar la migración sería un error.
"""

import re

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


async def _dni_opcional(conn) -> None:
    """La columna personas.dni pasa a aceptar NULL (personas sin DNI).

    SQLite no permite quitar un NOT NULL con ALTER TABLE: se rehace la tabla siguiendo
    el procedimiento recomendado (crear la nueva, copiar, borrar la vieja, renombrar).
    Las tablas que apuntan a personas (signos y kits) no se tocan: la referencia es por
    nombre de tabla y los ids se copian tal cual.
    """
    if conn.dialect.name != "sqlite":
        await conn.execute(text("ALTER TABLE personas ALTER COLUMN dni DROP NOT NULL"))
        return

    columnas = (await conn.execute(text("PRAGMA table_info(personas)"))).all()
    dni = next((c for c in columnas if c[1] == "dni"), None)
    if dni is None or not dni[3]:  # c[3] = notnull
        return

    crear = (
        await conn.execute(text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'personas'"))
    ).scalar_one()
    indices = [
        row[0]
        for row in (
            await conn.execute(
                text("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'personas' AND sql IS NOT NULL")
            )
        ).all()
    ]
    crear_nueva = re.sub(r"(\bdni\s+VARCHAR\(\d+\))\s+NOT NULL", r"\1", crear, count=1)
    crear_nueva = re.sub(r"^CREATE TABLE\s+\"?personas\"?", "CREATE TABLE personas_nueva", crear_nueva, count=1)
    if crear_nueva == crear or "NOT NULL" in re.search(r"\bdni\b[^,]*", crear_nueva).group(0):
        raise RuntimeError("No se pudo adaptar la tabla personas para que el DNI sea opcional.")

    nombres = ", ".join(f'"{c[1]}"' for c in columnas)
    await conn.execute(text("DROP TABLE IF EXISTS personas_nueva"))
    await conn.execute(text(crear_nueva))
    await conn.execute(text(f"INSERT INTO personas_nueva ({nombres}) SELECT {nombres} FROM personas"))
    await conn.execute(text("DROP TABLE personas"))
    await conn.execute(text("ALTER TABLE personas_nueva RENAME TO personas"))
    for sql in indices:
        await conn.execute(text(sql))


async def _quitar_dni_provisorios(conn) -> None:
    """Los DNI provisorios (90000001, 90000002, ...) que se inventaban para quien no tenía
    DNI pasan a quedar vacíos. Solo se tocan los del rango 90.000.000 - 90.999.999, que es
    el que generaba el sistema; los DNI reales de 91 millones en adelante no se tocan."""
    await conn.execute(
        text("UPDATE personas SET dni = NULL WHERE dni GLOB '90[0-9][0-9][0-9][0-9][0-9][0-9]'")
    )


MIGRACIONES = [
    ("0001_genero_v_m_nobinario", _migrar_genero_v_m_nb),
    ("0002_dni_opcional", _dni_opcional),
    ("0003_quitar_dni_provisorios", _quitar_dni_provisorios),
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
