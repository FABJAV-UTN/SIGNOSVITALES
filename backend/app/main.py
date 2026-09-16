from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .auth import router as auth_router
from .database import AsyncSessionLocal, get_session, init_db
from .models import Operativo
from .routers.kits import router as kits_router
from .routers.operativos import router as operativos_router
from .routers.personas import router as personas_router
from .routers.signos import router as signos_router

app = FastAPI(title="Registro Signos Vitales API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(personas_router, prefix="/api")
app.include_router(signos_router, prefix="/api")
app.include_router(kits_router, prefix="/api")
app.include_router(operativos_router, prefix="/api")


async def ensure_operativo() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Operativo).where(Operativo.activo.is_(True)))
        operativo = result.scalar_one_or_none()
        if operativo is None:
            default_operativo = Operativo(
                lugar="Museo Ferroviario",
                dia_semana="Jueves",
                hora=datetime.strptime("20:30", "%H:%M").time(),
                activo=True,
            )
            session.add(default_operativo)
            await session.commit()


@app.on_event("startup")
async def startup_event() -> None:
    await init_db()
    await ensure_operativo()
