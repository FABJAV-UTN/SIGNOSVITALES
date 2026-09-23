# SISVAP — Cruz Roja Argentina, Filial San Rafael

**Sistema de Información de Signos Vitales y Acompañamiento Psicosocial.**

Aplicación web para los voluntarios del programa de acompañamiento social de la Cruz Roja Filial San Rafael (Mendoza). Reemplaza las planillas en papel: registra personas beneficiarias, signos vitales (presión arterial, frecuencia cardíaca y saturación de oxígeno) y entregas de kits (PPAAS y ABRIGO), y permite consultar en el momento el historial de cada persona.

Proyecto de Práctica Profesional Supervisada (PPS), Tecnicatura Universitaria en Programación, UTN Facultad Regional San Rafael.

---

## Funcionalidades

- **Personas:** alta con DNI único y género (V / M / No binario), búsqueda por DNI, nombre o apellido (sin importar tildes), y ficha con totales de signos y kits.
- **Signos vitales:** registro individual con buscador con sugerencias, e historial por persona con gráfico de evolución (solo administrador).
- **Kits:** entrega individual, con aviso si la persona ya recibió ese tipo de kit en el día, e historial de entregas con totales y filtros.
- **Cargas masivas desde Excel** de personas, signos y kits:
  - las fechas se leen desde el valor real de la celda, sin importar el formato con que se muestren;
  - antes de guardar hay una **revisión previa**: se confirman los nombres parecidos a personas existentes (por ejemplo, «Norma Dias» → «Norma Díaz») y se elige a quién crear si no está en la base;
  - los duplicados no se cargan dos veces y los errores se informan con el número de fila del Excel.
- **Operativo activo:** lugar, día y hora de la jornada; cada registro de signos queda asociado al operativo.
- **Roles:** `voluntario` (carga y consulta del día) y `admin` (además, historial completo de signos).
- **Uso desde el celular:** interfaz responsiva, con pestañas en el historial.

## Stack

| Parte | Tecnologías |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async) + aiosqlite, Pydantic v2, Uvicorn, dependencias con `uv` |
| Base de datos | SQLite (un archivo en `backend/data/`, montado como volumen) |
| Autenticación | JWT (python-jose, HS256, 24 h) y contraseñas con bcrypt |
| Frontend | React 19, Vite, React Router, Axios, Recharts, SheetJS (lectura de Excel) |
| Despliegue | Docker Compose: Nginx sirve el frontend y hace de proxy de `/api` hacia el backend |
| Pruebas | pytest |

## Arquitectura

```
Navegador (voluntarios)
        │  http://<ip-de-la-notebook>
        ▼
┌───────────────────────┐        /api/*         ┌──────────────────────┐
│ vital_frontend         │ ─────────────────────▶ │ vital_backend         │
│ Nginx + build de React │                        │ FastAPI (puerto 8000) │
│ (puerto 80)            │ ◀───────────────────── │                        │
└───────────────────────┘        JSON           └──────────┬───────────┘
                                                             │
                                                  backend/data/signos_vitales.db (SQLite)
```

El sistema está pensado para correr **sin servidor ni Internet**: una notebook levanta los contenedores y comparte una red Wi-Fi local (hotspot). Los demás voluntarios entran desde el navegador del celular a `http://<ip-de-la-notebook>`.

## Estructura del proyecto

```
SIGNOSVITALES/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml / uv.lock
│   ├── app/
│   │   ├── main.py          # instancia FastAPI, CORS, arranque
│   │   ├── database.py      # motor async y sesión
│   │   ├── models.py        # tablas: personas, operativos, registro_signos_vitales, kits
│   │   ├── schemas.py       # validación Pydantic (fechas, género, tipo de kit, DNI…)
│   │   ├── auth.py          # login, JWT y roles
│   │   ├── matching.py      # comparación aproximada de nombres
│   │   ├── revision.py      # revisión previa de cargas masivas
│   │   ├── migrations.py    # correcciones de datos que se aplican una sola vez
│   │   └── routers/         # personas, signos, kits, operativos
│   ├── tests/               # pruebas con pytest
│   └── data/                # base SQLite (no se sube al repositorio)
└── frontend/
    ├── Dockerfile
    ├── nginx/default.conf   # SPA + proxy /api
    └── src/
        ├── App.jsx, api.js, App.css
        ├── components/      # pantallas y componentes (BuscarPersona, Historial, RevisionCarga…)
        └── utils/           # lectura de fechas de Excel, género
```

## Cómo levantar

Requisitos: Docker y Docker Compose.

```bash
git clone https://github.com/FABJAV-UTN/SIGNOSVITALES.git
cd SIGNOSVITALES
cp .env.example .env      # y editá .env: poné las contraseñas de admin y voluntario
docker compose up -d --build
```

- Aplicación: `http://localhost` (o `http://<ip-de-la-notebook>` desde otro dispositivo de la misma red; ver [Acceso con un nombre](#acceso-con-un-nombre-en-lugar-de-la-ip)).
- El backend **no** se publica fuera de Docker: solo se llega a él a través de Nginx, en `/api/`. La documentación interactiva de la API (`/docs`) está disponible cuando se corre el backend en modo desarrollo (ver más abajo).

La primera vez se crea sola la base vacía en `backend/data/signos_vitales.db`, con el operativo por defecto (Museo Ferroviario, jueves 20:30).

Comandos útiles:

```bash
docker compose logs -f backend     # ver logs del backend
docker compose restart backend     # reiniciar el backend
docker compose down                # apagar todo (los datos quedan en backend/data)
```

Después de modificar código, volvé a construir con `docker compose up -d --build`.

## Usuarios y permisos

Hay dos usuarios: `voluntario` y `admin`. Sus contraseñas **no están en el código**: se definen en el archivo `.env` de la raíz del proyecto (copiado de `.env.example`), que no se sube al repositorio. Sin esas contraseñas el backend no arranca.

| Variable en `.env` | Para qué |
|---|---|
| `SISVAP_ADMIN_PASSWORD` | Contraseña del usuario `admin` (obligatoria) |
| `SISVAP_VOLUNTARIO_PASSWORD` | Contraseña del usuario `voluntario` (obligatoria) |
| `SISVAP_SECRET_KEY` | Clave para firmar las sesiones (JWT). Si queda vacía se genera una al azar en cada arranque y hay que volver a iniciar sesión después de reiniciar el backend |

Para cambiar una contraseña: editá `.env` y ejecutá `docker compose up -d` (se reinicia el backend).

**El `.env` es por computadora**: como no se sube al repositorio, un `git pull` en otra máquina no lo trae. Hay que repetir el paso `cp .env.example .env` y completar las contraseñas en cada compu donde se instale el sistema (conviene usar las mismas contraseñas en todas). La `SISVAP_SECRET_KEY` no hace falta que sea igual en todas: solo hace que las sesiones no sean intercambiables entre backends distintos.

| Acción | voluntario | admin |
|---|:---:|:---:|
| Buscar y dar de alta personas | ✔ | ✔ |
| Registrar signos y entregar kits | ✔ | ✔ |
| Cargas masivas (personas, signos, kits) | ✔ | ✔ |
| Historial de kits y configurar el operativo | ✔ | ✔ |
| Historial de signos (general y por persona) | — | ✔ |

Todas las rutas de la API, salvo el login y la consulta del operativo activo, exigen haber iniciado sesión.

## Acceso con un nombre en lugar de la IP

En el operativo, la notebook comparte un hotspot y los celulares se conectan a esa red. Hay tres maneras de que no haga falta tipear la IP; se pueden combinar.

**1. Código QR (lo más simple).** Si el hotspot se crea con NetworkManager (la opción "Punto de acceso Wi-Fi" de Ubuntu), la notebook siempre queda con la IP `10.42.0.1`. Un QR impreso con `http://10.42.0.1` en la mesa del operativo alcanza: se escanea con la cámara y abre el sistema.

**2. Un nombre propio en el hotspot, por ejemplo `http://sisvap.lan`.** El hotspot de NetworkManager usa `dnsmasq` para dar las direcciones a los celulares; se le puede agregar un nombre. Una sola vez, en la notebook:

```bash
echo "address=/sisvap.lan/10.42.0.1" | sudo tee /etc/NetworkManager/dnsmasq-shared.d/sisvap.conf
```

Después apagá y volvé a encender el hotspot. Cualquier celular conectado a esa red abre el sistema en `http://sisvap.lan`. Usá una terminación como `.lan`, no `.com`: un `.com` puede existir en Internet, y algunos navegadores fuerzan HTTPS en ciertos dominios. Si un teléfono tiene configurado un "DNS privado" fijo (Android → Ajustes → Red → DNS privado), puede ignorar el nombre: en ese caso, dejarlo en "Automático" o usar el QR.

**3. `http://<nombre-de-la-notebook>.local`.** Ubuntu anuncia su nombre en la red (Avahi/mDNS). Funciona bien en iPhone y en computadoras; en Android depende de la versión, así que no conviene depender solo de esto.

## Cargas masivas desde Excel

Los encabezados no distinguen mayúsculas, tildes ni guiones bajos.

| Carga | Columnas |
|---|---|
| Personas | `nombre`, `apellido`, `dni` (opcionales: `fecha_nacimiento`, `genero`, `situacion_de_calle`) |
| Signos | `identificador` (DNI o Nombre y Apellido), `fecha`, `presion_arterial`, `frecuencia_cardiaca`, `oxigenacion_sangre` |
| Kits | `identificador`, `fecha`, `tipo` (PPAAS o ABRIGO). La página ofrece descargar una planilla modelo. |

- **Fechas:** celda con formato de fecha, `AAAA-MM-DD` o `DD/MM/AAAA`.
- **Género:** `V` (varón), `M` (mujer) o `No binario`. Si la planilla usa la convención vieja M/F, la M se toma como masculino.
- **Personas creadas sin DNI:** reciben un DNI provisorio que empieza con 9.

## Base de datos

- Archivo: `backend/data/signos_vitales.db`. Contiene datos de salud de personas reales: **no se sube al repositorio** (`*.db` está en el `.gitignore`) y conviene hacer backups periódicos:

  ```bash
  sudo cp backend/data/signos_vitales.db "backend/data/signos_vitales.backup-$(date +%F-%H%M).db"
  ```

- No borres la tabla `app_data_migrations`: registra correcciones de datos ya aplicadas (por ejemplo, la conversión del género) para que no se repitan.
- Para consultar, borrar o vaciar la base desde la consola, hay una guía aparte (`MANEJO_BASE_DE_DATOS.md`).

## Desarrollo y pruebas

Backend, sin Docker:

```bash
cd backend
uv sync
set -a; source ../.env; set +a   # carga las contraseñas del .env
uv run uvicorn app.main:app --reload --port 8000   # documentación en http://localhost:8000/docs
uv run pytest                     # pruebas
```

Las pruebas usan siempre una base temporal y contraseñas de prueba (`tests/conftest.py`), así que no tocan `backend/data/signos_vitales.db` ni necesitan el `.env`.

Frontend, sin Docker:

```bash
cd frontend
npm ci
npm run dev                       # http://localhost:3000
npm run lint
```

El proxy de desarrollo (`frontend/vite.config.js`) apunta a `http://backend:8000`, que es el nombre del servicio dentro de Docker. Si corrés el backend en tu máquina, cambialo por `http://localhost:8000`.

## Autores

- **Fabio Javier Flores** — backend
- **Fernando Matías Cala** — frontend

Tecnicatura Universitaria en Programación, UTN Facultad Regional San Rafael, en el marco del proyecto *Elijo Ayudar* de Cruz Roja Argentina, Filial San Rafael.

## Licencia

MIT. Ver [LICENSE](LICENSE).
