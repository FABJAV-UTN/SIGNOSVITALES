# Registro de Signos Vitales - Cruz Roja Argentina

Sistema web para voluntarios que registran signos vitales de personas en situación de calle y familias carenciadas.

## Stack

- Backend: FastAPI + SQLAlchemy + SQLite + Alembic + Uvicorn + Python 3.12
- Frontend: React + Vite + Axios + React Router DOM + Recharts
- Autenticación: JWT con python-jose + passlib (bcrypt)
- Deploy: Docker Compose con frontend servido por Nginx y backend en Uvicorn

## Cómo levantar

Desde la raíz del proyecto:

```bash
docker compose up --build
```

- Backend en `http://localhost:8000`
- Frontend en `http://localhost`

## Credenciales de prueba

- voluntario / cruzroja2024
- admin / admin2024

## Notas

- El frontend se comunica con el backend a través de `/api`.
- El historial completo y la consulta de entregas solo están disponibles para el rol `admin`.
