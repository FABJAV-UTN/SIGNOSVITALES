from datetime import datetime, timedelta
import os
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import bcrypt

from .schemas import LoginRequest, LoginResponse

# Las credenciales NO están en el código: se leen de variables de entorno
# (archivo .env en la raíz del proyecto, que no se sube al repositorio).
# Ver .env.example.
def _env_obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        raise RuntimeError(
            f"Falta la variable de entorno {nombre}. "
            "Copiá .env.example como .env en la raíz del proyecto y completá las contraseñas."
        )
    return valor


# Clave para firmar los JWT. Si no se define, se genera una al azar en cada arranque
# (es segura, pero al reiniciar el backend todos tienen que volver a iniciar sesión).
SECRET_KEY = os.getenv("SISVAP_SECRET_KEY", "").strip() or secrets.token_urlsafe(48)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 24 * 60

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


USERS = {
    "voluntario": {
        "hashed_password": _hash_password(_env_obligatoria("SISVAP_VOLUNTARIO_PASSWORD")),
        "role": "voluntario",
    },
    "admin": {
        "hashed_password": _hash_password(_env_obligatoria("SISVAP_ADMIN_PASSWORD")),
        "role": "admin",
    },
}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
router = APIRouter(prefix="/auth", tags=["auth"])


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def authenticate_user(username: str, password: str) -> dict | None:
    user = USERS.get(username)
    if not user or not verify_password(password, user["hashed_password"]):
        return None
    return {"username": username, "role": user["role"]}


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    payload = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


@router.post("/login", response_model=LoginResponse)
async def login(form_data: LoginRequest) -> LoginResponse:
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token({"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer", "role": user["role"]}


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autenticado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        role: str | None = payload.get("role")
        if username is None or role is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = USERS.get(username)
    if not user:
        raise credentials_exception
    return {"username": username, "role": role}


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acceso restringido")
    return current_user
