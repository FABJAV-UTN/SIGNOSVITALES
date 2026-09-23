# Manejo de la base de datos — SISVAP

Guía rápida para entrar a la base, consultar, borrar registros y vaciarla.

> ⚠️ La base tiene **datos de salud de personas reales**. Antes de borrar o modificar algo, **hacé un backup** (ver sección 2). Lo que se borra con SQL no se puede deshacer.

---

## 1. Dónde está la base

- Motor: **SQLite** (un solo archivo).[text](informes/MANEJO_BASE_DE_DATOS.md)
- Archivo: `backend/data/signos_vitales.db`
- Docker monta esa carpeta en el contenedor `vital_backend` como `/app/data`, así que es **el mismo archivo** visto desde tu compu o desde el contenedor.
- La carpeta `backend/data` la crea Docker con dueño `root`, por eso en tu compu los comandos llevan `sudo`.

Tablas:

| Tabla | Qué guarda |
|---|---|
| `personas` | Beneficiarios (nombre, apellido, DNI único, fecha de nacimiento, género `V`/`M`/`No binario`, situación de calle) |
| `registro_signos_vitales` | Cada toma de signos: `persona_id`, `operativo_id`, fecha, hora, presión, FC, SpO₂ |
| `kits` | Cada entrega: `persona_id`, tipo (`PPAAS` / `ABRIGO`), fecha de entrega |
| `operativos` | Lugar, día y hora del operativo; uno solo con `activo = 1` |
| `app_data_migrations` | Correcciones de datos ya aplicadas. **No tocar** (ver sección 7) |

`registro_signos_vitales` y `kits` apuntan a `personas` por `persona_id`.

---

## 2. Backup y restauración

**Hacer un backup** (con fecha y hora en el nombre):

```bash
cd ~/Documentos/SIGNOSVITALES
sudo cp backend/data/signos_vitales.db "backend/data/signos_vitales.backup-$(date +%F-%H%M).db"
```

Si el sistema está en uso, es más seguro frenar el backend un momento:

```bash
docker compose stop backend
sudo cp backend/data/signos_vitales.db "backend/data/signos_vitales.backup-$(date +%F-%H%M).db"
docker compose start backend
```

**Restaurar un backup:**

```bash
docker compose stop backend
sudo cp backend/data/signos_vitales.backup-AAAA-MM-DD-HHMM.db backend/data/signos_vitales.db
docker compose start backend
```

> Los `.db` están en el `.gitignore`: los backups **no** se suben a GitHub. Guardalos en un lugar seguro.

---

## 3. Cómo entrar a la base

### Opción A — consola `sqlite3` (recomendada)

Instalar una sola vez:

```bash
sudo apt install sqlite3
```

Entrar:

```bash
cd ~/Documentos/SIGNOSVITALES
sudo sqlite3 backend/data/signos_vitales.db
```

Configuración útil apenas entrás (para ver la salida en columnas y activar las claves foráneas):

```sql
.headers on
.mode column
PRAGMA foreign_keys = ON;
```

Comandos de la consola (empiezan con punto y **no** llevan `;`):

| Comando | Para qué |
|---|---|
| `.tables` | Lista las tablas |
| `.schema personas` | Muestra cómo está definida una tabla |
| `.headers on` / `.mode column` | Salida legible |
| `.quit` | Salir |

Las consultas SQL **sí** terminan en `;`.

### Opción B — interfaz gráfica

**DB Browser for SQLite**:

```bash
sudo apt install sqlitebrowser
sudo sqlitebrowser backend/data/signos_vitales.db
```

Permite ver y editar las tablas como una planilla. Los cambios se guardan recién con **"Escribir cambios"** (Ctrl+S).

---

## 4. Consultas útiles

```sql
-- Cuántos registros hay en cada tabla
SELECT (SELECT COUNT(*) FROM personas)                AS personas,
       (SELECT COUNT(*) FROM registro_signos_vitales) AS signos,
       (SELECT COUNT(*) FROM kits)                    AS kits;

-- Buscar una persona por DNI
SELECT * FROM personas WHERE dni = '12345678';

-- Buscar por nombre o apellido (no distingue mayúsculas en letras sin tilde)
SELECT id, nombre, apellido, dni FROM personas
WHERE nombre LIKE '%juan%' OR apellido LIKE '%perez%';

-- Signos de una persona, del más nuevo al más viejo
SELECT r.id, r.fecha, r.hora, r.presion_arterial, r.frecuencia_cardiaca, r.oxigenacion_sangre
FROM registro_signos_vitales r
JOIN personas p ON p.id = r.persona_id
WHERE p.dni = '12345678'
ORDER BY r.fecha DESC, r.hora DESC;

-- Kits de una persona
SELECT k.id, k.tipo, k.fecha_entrega
FROM kits k JOIN personas p ON p.id = k.persona_id
WHERE p.dni = '12345678'
ORDER BY k.fecha_entrega DESC;

-- Personas con DNI provisorio (creadas sin DNI desde una carga masiva)
SELECT id, nombre, apellido, dni FROM personas WHERE dni LIKE '9%' AND LENGTH(dni) = 8;

-- Personas sin ninguna atención (ni signos ni kits)
SELECT p.id, p.nombre, p.apellido, p.dni
FROM personas p
WHERE NOT EXISTS (SELECT 1 FROM registro_signos_vitales r WHERE r.persona_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM kits k WHERE k.persona_id = p.id);
```

---

## 5. Eliminar un registro

**Siempre mirá primero con un `SELECT`** qué vas a borrar, y después ejecutá el `DELETE` con la **misma** condición.

### Un registro de signos

```sql
SELECT * FROM registro_signos_vitales WHERE id = 57;   -- revisar
DELETE FROM registro_signos_vitales WHERE id = 57;
```

### Una entrega de kit

```sql
SELECT * FROM kits WHERE id = 12;
DELETE FROM kits WHERE id = 12;
```

### Una persona completa (con sus signos y kits)

> ⚠️ SQLite **no** borra en cascada desde la consola: si borrás solo la persona, sus signos y kits quedan "huérfanos". Hay que borrar primero los registros que dependen de ella. Hacelo dentro de una transacción:

```sql
BEGIN;
DELETE FROM kits                    WHERE persona_id = (SELECT id FROM personas WHERE dni = '12345678');
DELETE FROM registro_signos_vitales WHERE persona_id = (SELECT id FROM personas WHERE dni = '12345678');
DELETE FROM personas                WHERE dni = '12345678';
COMMIT;
```

Si algo salió distinto de lo esperado **antes** del `COMMIT`, escribí `ROLLBACK;` y no se aplica nada.

### Todo lo cargado en una fecha (por ejemplo, una carga masiva equivocada)

```sql
SELECT COUNT(*) FROM registro_signos_vitales WHERE fecha = '2026-09-10';
DELETE FROM registro_signos_vitales WHERE fecha = '2026-09-10';
```

---

## 6. Corregir datos

```sql
-- Completar el DNI real de alguien que tenía uno provisorio
UPDATE personas SET dni = '30123456' WHERE dni = '90000001';

-- Corregir nombre o apellido
UPDATE personas SET nombre = 'Sulma', apellido = 'Sánchez' WHERE id = 9;

-- Género (solo 'V', 'M' o 'No binario'; M = mujer)
UPDATE personas SET genero = 'M' WHERE id = 9;

-- Pasar los signos de una persona duplicada a la correcta y borrar el duplicado
BEGIN;
UPDATE registro_signos_vitales SET persona_id = 9 WHERE persona_id = 41;
UPDATE kits                    SET persona_id = 9 WHERE persona_id = 41;
DELETE FROM personas WHERE id = 41;
COMMIT;
```

El DNI es único: si el `UPDATE` falla con `UNIQUE constraint failed`, ya hay otra persona con ese DNI (probablemente un duplicado; usá el último ejemplo para unificarlas).

---

## 7. Vaciar la base y reiniciar los id

Hay dos formas. En las dos los `id` vuelven a empezar desde 1: las tablas no usan `AUTOINCREMENT`, así que SQLite toma el id más alto que exista + 1, y en una tabla vacía eso es 1.

### Opción A — borrar los datos y conservar el archivo

```bash
docker compose stop backend
sudo cp backend/data/signos_vitales.db "backend/data/signos_vitales.backup-$(date +%F-%H%M).db"
sudo sqlite3 backend/data/signos_vitales.db
```

```sql
BEGIN;
DELETE FROM kits;
DELETE FROM registro_signos_vitales;
DELETE FROM personas;
COMMIT;
VACUUM;
.quit
```

`VACUUM` libera el espacio del archivo. Escribí los comandos tal cual, sin comentarios (`-- ...`) al final de la línea: la consola de `sqlite3` los toma como el comienzo de otra instrucción, queda esperando un `;` (el prompt cambia a `...>`) y ya no reconoce `.quit`. Si te pasa, escribí `;` y Enter (va a mostrar un error, no pasa nada) y después `.quit`, o salí con **Ctrl+D**.

```bash
docker compose start backend
```

Se conserva el operativo configurado (lugar, día y hora). Si también querés reiniciarlo, agregá `DELETE FROM operativos;` antes del `COMMIT`: al arrancar, el backend crea uno nuevo por defecto (Museo Ferroviario, jueves 20:30).

> ❗ **No borres `app_data_migrations`.** Esa tabla registra que la corrección del género (`M` = masculino → `V`) ya se aplicó. Si la vaciás, al reiniciar el backend la corrección se vuelve a ejecutar y **convierte a todas las mujeres (`M`) en varones (`V`)**.

### Opción B — empezar con un archivo nuevo

```bash
docker compose stop backend
sudo mv backend/data/signos_vitales.db "backend/data/signos_vitales.backup-$(date +%F-%H%M).db"
docker compose start backend
```

Al arrancar sin archivo, el backend crea la base vacía con todas las tablas, el operativo por defecto y la tabla `app_data_migrations` ya marcada. Es la forma más limpia.

---

## 8. Resumen de precauciones

1. **Backup antes de cualquier `DELETE` o `UPDATE`.**
2. `SELECT` primero, `DELETE`/`UPDATE` después, con la misma condición.
3. Para borrar personas: primero sus `kits` y `registro_signos_vitales`, dentro de `BEGIN; … COMMIT;`.
4. Nunca borrar `app_data_migrations`.
5. Para operaciones grandes, frenar el backend (`docker compose stop backend`) y volver a levantarlo al terminar.
6. Los backups tienen datos reales: no los compartas ni los subas al repositorio.
