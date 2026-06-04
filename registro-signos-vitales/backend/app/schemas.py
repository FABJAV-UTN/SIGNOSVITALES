from datetime import date, datetime, time
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field, ValidationError, conint, constr, confloat, field_validator, model_validator

DNI_REGEX = r"^\d{7,8}$"
PRESION_REGEX = r"^\d{2,3}/\d{2,3}$"

class LoginRequest(BaseModel):
    username: constr(strip_whitespace=True, min_length=3)
    password: constr(strip_whitespace=True, min_length=6)

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    role: str

class PersonaCreate(BaseModel):
    nombre: constr(strip_whitespace=True, min_length=2)
    apellido: constr(strip_whitespace=True, min_length=2)
    dni: constr(pattern=DNI_REGEX)
    fecha_nacimiento: Optional[date] = None
    genero: Optional[constr(strip_whitespace=True, min_length=2)] = None
    situacion_de_calle: bool = False

class PersonaRead(PersonaCreate):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}

class OperativoUpdate(BaseModel):
    lugar: constr(strip_whitespace=True, min_length=3)
    dia_semana: constr(strip_whitespace=True, min_length=3)
    hora: time

class OperativoRead(OperativoUpdate):
    id: int
    activo: bool

    model_config = {"from_attributes": True}

class SignosCreate(BaseModel):
    dni: constr(pattern=DNI_REGEX)
    presion_arterial: Optional[constr(pattern=PRESION_REGEX)] = None
    frecuencia_cardiaca: Optional[conint(ge=30, le=220)] = None
    oxigenacion_sangre: Optional[confloat(ge=70.0, le=100.0)] = None
    fecha: Optional[date] = None
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

class SignosRead(BaseModel):
    id: int
    persona_id: int
    operativo_id: int
    fecha: date
    hora: time
    presion_arterial: Optional[str] = None
    frecuencia_cardiaca: Optional[int] = None
    oxigenacion_sangre: Optional[float] = None
    persona: PersonaRead
    operativo: OperativoRead

    model_config = {"from_attributes": True}

class SignosBulkRow(BaseModel):
    identificador: Optional[str] = None
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    signos: constr(strip_whitespace=True, min_length=1)
    fecha: date
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

    @model_validator(mode="after")
    def ensure_identificador(cls, values):
        identificador = values.identificador or values.dni
        if not identificador or not identificador.strip():
            raise ValueError("Debe proporcionar DNI o Nombre y Apellido en la primera columna.")
        values.identificador = identificador.strip()
        return values

class SignosBulkRequest(BaseModel):
    rows: list[SignosBulkRow]
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

class SignosBulkResponse(BaseModel):
    ok: int
    errores: list[str]

class KitCreate(BaseModel):
    dni: constr(pattern=DNI_REGEX)
    tipo: constr(strip_whitespace=True, min_length=1)

    @field_validator("tipo")
    @classmethod
    def valid_tipo(cls, value: str) -> str:
        tipos = {"PPAAS", "ABRIGO"}
        if value not in tipos:
            raise ValueError("Tipo de kit debe ser PPAAS o ABRIGO")
        return value

class KitRead(BaseModel):
    id: int
    persona_id: int
    tipo: str
    fecha_entrega: date
    persona: PersonaRead

    model_config = {"from_attributes": True}

class PersonaShortRead(BaseModel):
    id: int
    nombre: str
    apellido: str
    dni: str

    model_config = {"from_attributes": True}

class HistorialFilter(BaseModel):
    desde: Optional[date] = None
    hasta: Optional[date] = None
    q: Optional[str] = None

class SignosRecord(BaseModel):
    fecha: date
    hora: time
    presion_arterial: Optional[str] = None
    frecuencia_cardiaca: Optional[int] = None
    oxigenacion_sangre: Optional[float] = None
    lugar: str

    model_config = {"from_attributes": True}