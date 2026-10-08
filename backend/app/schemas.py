from datetime import date, datetime, time, timedelta
from enum import Enum
import re
import unicodedata
from typing import Any, List, Optional

from pydantic import BaseModel, Field, ValidationError, conint, constr, confloat, field_validator, model_validator

DNI_REGEX = r"^\d{6,9}$"
PRESION_REGEX = r"^\d{2,3}/\d{2,3}$"


def _normalize_date_value(value: Any) -> Any:
    if value is None or value == "":
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        excel_epoch = datetime(1899, 12, 30)
        return (excel_epoch + timedelta(days=float(value))).date()

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None

        if re.fullmatch(r"^\d{5,7}(?:\.\d+)?$", text):
            try:
                excel_epoch = datetime(1899, 12, 30)
                return (excel_epoch + timedelta(days=float(text))).date()
            except Exception:
                pass

        cleaned = text.replace("T", " ").replace("Z", "").strip()
        try:
            return date.fromisoformat(cleaned)
        except ValueError:
            pass

        for fmt in (
            "%d/%m/%Y",
            "%d/%m/%y",
            "%d-%m-%Y",
            "%d-%m-%y",
            "%d.%m.%Y",
            "%d.%m.%y",
            "%m/%d/%Y",
            "%m/%d/%y",
            "%m-%d-%Y",
            "%m-%d-%y",
            "%Y/%m/%d",
            "%Y-%m-%d",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%Y/%m/%d %H:%M:%S",
        ):
            try:
                return datetime.strptime(cleaned, fmt).date()
            except ValueError:
                continue

        try:
            return datetime.fromisoformat(cleaned).date()
        except ValueError:
            return value

    return value


GENEROS_VALIDOS = ("V", "M", "No binario")

_GENERO_ALIASES = {
    "v": "V", "varon": "V", "masculino": "V", "hombre": "V", "h": "V",
    "m": "M", "mujer": "M", "femenino": "M", "f": "M",
    "no binario": "No binario", "no-binario": "No binario", "nobinario": "No binario", "nb": "No binario", "x": "No binario",
}


def _strip_accents(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")


def normalize_genero(value: Any, strict: bool = True) -> Optional[str]:
    """Normaliza el género a uno de GENEROS_VALIDOS: 'V' (varón), 'M' (mujer) o 'No binario'.

    OJO: 'M' significa MUJER. Con strict=True un valor desconocido lanza ValueError;
    con strict=False se devuelve tal cual (para leer datos viejos sin romper listados).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    key = _strip_accents(text).casefold()
    key = re.sub(r"\s+", " ", key)
    if key in _GENERO_ALIASES:
        return _GENERO_ALIASES[key]
    if strict:
        raise ValueError("género inválido: usar 'V' (varón), 'M' (mujer) o 'No binario'")
    return text


def format_validation_errors(exc: ValidationError) -> str:
    """Arma un mensaje legible por fila, indicando campo y valor recibido."""
    partes = []
    for error in exc.errors():
        campo = ".".join(str(p) for p in error.get("loc", ())) or "fila"
        valor = error.get("input")
        if campo in ("fecha", "fecha_nacimiento"):
            if valor in (None, ""):
                partes.append(f"{campo}: falta la fecha")
            else:
                partes.append(f"{campo}: fecha inválida '{valor}' (usar AAAA-MM-DD o DD/MM/AAAA)")
        else:
            mensaje = error["msg"].removeprefix("Value error, ")
            partes.append(f"{campo}: {mensaje}")
    return ", ".join(partes)


def limpiar_dni_opcional(v: Any) -> Optional[str]:
    """'30.123.456', ' 30123456 ', 30123456 o 30123456.0 -> '30123456'; vacío -> None."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    texto = str(v).strip()
    numero_excel = re.fullmatch(r"(\d+)\.0+", texto)  # "30123456.0": número de Excel leído como texto
    if numero_excel:
        texto = numero_excel.group(1)
    return re.sub(r"[\s.-]", "", texto) or None


def limpiar_texto_opcional(v: Any) -> Optional[str]:
    if v is None:
        return None
    texto = re.sub(r"\s+", " ", str(v)).strip()
    return texto or None


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
    # Opcional: si no se sabe, queda vacío y se puede completar después.
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    fecha_nacimiento: Optional[date] = None
    genero: Optional[str] = Field(default=None, description="'V' (varón), 'M' (mujer) o 'No binario'")
    situacion_de_calle: bool = False

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @field_validator("fecha_nacimiento", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    @field_validator("genero", mode="before")
    @classmethod
    def clean_genero(cls, v: Any) -> Optional[str]:
        return normalize_genero(v, strict=True)

class PersonaRead(BaseModel):
    # Sin las restricciones de PersonaCreate: al leer de la base se muestra lo que haya.
    id: int
    nombre: str
    apellido: str
    dni: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    genero: Optional[str] = None
    situacion_de_calle: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("genero", mode="before")
    @classmethod
    def clean_genero(cls, v: Any) -> Optional[str]:
        # Al leer de la base no se rechaza nada: si quedara un valor viejo, se muestra tal cual.
        return normalize_genero(v, strict=False)

class PersonaListItem(PersonaRead):
    total_signos: int = 0
    total_kits: int = 0


class PersonaUpdate(BaseModel):
    """Edición a mano de una persona. Solo se cambian los campos que vienen en el pedido;
    mandar dni o fecha_nacimiento en null (o vacío) los deja en blanco."""
    nombre: Optional[constr(strip_whitespace=True, min_length=2)] = None
    apellido: Optional[constr(strip_whitespace=True, min_length=2)] = None
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    fecha_nacimiento: Optional[date] = None
    genero: Optional[str] = None
    situacion_de_calle: Optional[bool] = None

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @field_validator("fecha_nacimiento", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    @field_validator("genero", mode="before")
    @classmethod
    def clean_genero(cls, v: Any) -> Optional[str]:
        return normalize_genero(v, strict=True)


class ActualizacionPersona(BaseModel):
    """Dato a completar/actualizar que se confirmó en la revisión de una carga masiva."""
    persona_id: int
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    fecha_nacimiento: Optional[date] = None

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @field_validator("fecha_nacimiento", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)


class ActualizacionesRequest(BaseModel):
    cambios: list[ActualizacionPersona]


class ActualizacionesResponse(BaseModel):
    ok: int
    errores: list[str]


class DatosPersonaFila(BaseModel):
    """Columnas de persona de cualquier planilla: Nombre, Apellido, DNI y Fecha de nacimiento.
    Cualquiera puede venir en blanco (pero no todas a la vez)."""
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    fecha_nacimiento: Optional[date] = None

    @field_validator("nombre", "apellido", mode="before")
    @classmethod
    def clean_texto(cls, v: Any) -> Optional[str]:
        return limpiar_texto_opcional(v)

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @field_validator("fecha_nacimiento", mode="before")
    @classmethod
    def clean_fecha_nacimiento(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    def tiene_datos_persona(self) -> bool:
        return bool(self.dni or self.nombre or self.apellido)

    @property
    def etiqueta(self) -> str:
        """Texto para mostrar/agrupar: 'Juan Pérez · DNI 30123456', 'Juan Pérez' o 'DNI 30123456'."""
        nombre = " ".join(p for p in (self.nombre, self.apellido) if p)
        if nombre and self.dni:
            return f"{nombre} · DNI {self.dni}"
        return nombre or (f"DNI {self.dni}" if self.dni else "")

class PersonaBulkRow(DatosPersonaFila):
    """Fila de la planilla de personas (y de las altas confirmadas en una revisión)."""
    fila: Optional[int] = None
    genero: Optional[str] = None
    situacion_de_calle: bool = False

    @field_validator("genero", mode="before")
    @classmethod
    def clean_genero(cls, v: Any) -> Optional[str]:
        return normalize_genero(v, strict=True)

    @field_validator("situacion_de_calle", mode="before")
    @classmethod
    def clean_calle(cls, v: Any) -> bool:
        if v is None or v == "":
            return False
        if isinstance(v, str):
            return _strip_accents(v).strip().casefold() in ("true", "1", "si", "s", "yes", "y", "x")
        return bool(v)

class PersonaBulkRequest(BaseModel):
    # Las filas se reciben sin validar y se validan una por una en el endpoint,
    # así un dato inválido (ej. una fecha mal formada) solo descarta esa fila
    # en vez de rechazar todo el archivo con un 422.
    rows: list[Optional[dict[str, Any]]]

class PersonaCreada(BaseModel):
    fila: int
    id: int
    nombre: str
    apellido: str
    dni: Optional[str] = None

class PersonaBulkResponse(BaseModel):
    ok: int
    total: int
    errores: list[str]
    # Personas efectivamente creadas, con el número de fila del request (1-based),
    # para que el frontend pueda asociarlas (ej. carga masiva de signos).
    creadas: list[PersonaCreada] = []

class OperativoUpdate(BaseModel):
    lugar: constr(strip_whitespace=True, min_length=3)
    dia_semana: constr(strip_whitespace=True, min_length=3)
    hora: time

class OperativoRead(OperativoUpdate):
    id: int
    activo: bool

    model_config = {"from_attributes": True}

class SignosCreate(BaseModel):
    # La persona se indica por id (puede no tener DNI). Se acepta dni por compatibilidad.
    persona_id: Optional[int] = None
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    presion_arterial: Optional[constr(pattern=PRESION_REGEX)] = None
    frecuencia_cardiaca: Optional[conint(ge=30, le=220)] = None
    oxigenacion_sangre: Optional[confloat(ge=70.0, le=100.0)] = None
    fecha: Optional[date] = None
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @model_validator(mode="after")
    def requiere_persona(self):
        if self.persona_id is None and not self.dni:
            raise ValueError("Falta indicar la persona (persona_id)")
        return self

    @field_validator("fecha", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    @field_validator("presion_arterial", mode="before")
    @classmethod
    def clean_presion(cls, v: Any) -> Optional[str]:
        if isinstance(v, str):
            val = v.strip()
            return val if val else None
        return v

    @field_validator("frecuencia_cardiaca", mode="before")
    @classmethod
    def clean_fc(cls, v: Any) -> Optional[int]:
        if v == "" or v is None or v == 0:
            return None
        return v

    @field_validator("oxigenacion_sangre", mode="before")
    @classmethod
    def clean_spo2(cls, v: Any) -> Optional[float]:
        if v == "" or v is None or v == 0 or v == 0.0:
            return None
        return v

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

class SignosBulkRow(DatosPersonaFila):
    # Si viene persona_id (ya resuelto en la revisión previa), se usa directo y no se busca
    # por nombre/apellido/DNI.
    persona_id: Optional[int] = None
    # Número de fila original del archivo, para que los errores coincidan con el Excel.
    fila: Optional[int] = None
    signos: constr(strip_whitespace=True, min_length=1)
    fecha: date
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

    @field_validator("fecha", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    @model_validator(mode="after")
    def requiere_persona(self):
        if self.persona_id is None and not self.tiene_datos_persona():
            raise ValueError("falta la persona: completar Nombre y Apellido, DNI o ambos")
        return self

class SignosBulkRequest(BaseModel):
    # Ver comentario en PersonaBulkRequest: validación por fila en el endpoint.
    rows: list[Optional[dict[str, Any]]]
    operativo_id: Optional[int] = None
    lugar_custom: Optional[constr(strip_whitespace=True, min_length=3)] = None

class SignosBulkResponse(BaseModel):
    ok: int
    errores: list[str]

class KitCreate(BaseModel):
    persona_id: Optional[int] = None
    dni: Optional[constr(pattern=DNI_REGEX)] = None
    tipo: constr(strip_whitespace=True, min_length=1)

    @field_validator("dni", mode="before")
    @classmethod
    def clean_dni(cls, v: Any) -> Optional[str]:
        return limpiar_dni_opcional(v)

    @model_validator(mode="after")
    def requiere_persona(self):
        if self.persona_id is None and not self.dni:
            raise ValueError("Falta indicar la persona (persona_id)")
        return self

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
    dni: Optional[str] = None

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

# ---------- Revisión previa de la carga masiva de signos ----------

class PersonaCandidata(BaseModel):
    id: int
    nombre: str
    apellido: str
    dni: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    similitud: float

class IdentificadorRevision(BaseModel):
    # Texto que identifica al grupo de filas (ej. "Juan Pérez · DNI 30123456"); es la clave
    # con la que el frontend arma las decisiones.
    identificador: str
    filas: list[int]
    # "exacta": coincide con una sola persona -> se carga directo.
    # "sugerencia": no coincide exacto, pero hay personas parecidas -> hay que confirmar.
    # "ambigua": coincide exacto con más de una persona -> hay que elegir.
    # "conflicto_dni": el DNI de la planilla es de alguien con otro nombre -> hay que confirmar.
    # "no_encontrada": no hay nadie parecido -> se puede crear la persona.
    estado: str
    # Lo que dice la planilla (para completar/actualizar datos de la persona elegida).
    dni: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    # Si el DNI de la planilla ya lo tiene alguien en la base: su id (no se puede asignar a otro).
    dni_en_uso_por: Optional[int] = None
    persona: Optional[PersonaCandidata] = None
    candidatos: list[PersonaCandidata] = []
    nombre_sugerido: str = ""
    apellido_sugerido: str = ""
    # Para "no_encontrada": otro identificador del mismo archivo que parece la misma persona
    # (ej. "Marelo Tercero" -> "Marcelo Tercero"), para no crearla dos veces.
    parecido_a: Optional[str] = None

class FilaInvalida(BaseModel):
    fila: int
    error: str

class SignosBulkPreviewResponse(BaseModel):
    total_filas: int
    identificadores: list[IdentificadorRevision]
    invalidas: list[FilaInvalida]

# La misma respuesta de revisión sirve para cualquier carga masiva.
BulkPreviewResponse = SignosBulkPreviewResponse


# ---------- Carga masiva de kits ----------

TIPOS_KIT = ("PPAAS", "ABRIGO")


def normalize_tipo_kit(value: Any) -> Optional[str]:
    if value is None:
        return None
    texto = _strip_accents(str(value)).casefold().strip()
    texto = re.sub(r"^kit\s+", "", texto)
    if not texto:
        return None
    if texto in ("ppaas", "higiene", "primeros auxilios", "higiene / primeros auxilios", "higiene y primeros auxilios"):
        return "PPAAS"
    if texto in ("abrigo", "abrigos"):
        return "ABRIGO"
    raise ValueError("tipo de kit inválido: usar PPAAS o ABRIGO")


class KitBulkRow(DatosPersonaFila):
    persona_id: Optional[int] = None
    fila: Optional[int] = None
    tipo: str
    fecha: date

    @field_validator("tipo", mode="before")
    @classmethod
    def clean_tipo(cls, v: Any) -> Optional[str]:
        return normalize_tipo_kit(v)

    @field_validator("fecha", mode="before")
    @classmethod
    def clean_fecha(cls, v: Any) -> Any:
        return _normalize_date_value(v)

    @model_validator(mode="after")
    def requiere_persona(self):
        if self.persona_id is None and not self.tiene_datos_persona():
            raise ValueError("falta la persona: completar Nombre y Apellido, DNI o ambos")
        return self


class KitBulkRequest(BaseModel):
    rows: list[Optional[dict[str, Any]]]


class KitBulkResponse(BaseModel):
    ok: int
    errores: list[str]


# ---------- Personas repetidas ----------

class PersonaRepetida(PersonaListItem):
    # Con quién se parece dentro del grupo y cuánto (para mostrar el motivo).
    parecida_a: list[int] = []
    similitud_max: float = 0.0


class GrupoRepetidos(BaseModel):
    personas: list[PersonaRepetida]
    # Registro sugerido para conservar: el que tiene DNI o más atenciones.
    sugerida_id: int


class UnificarRequest(BaseModel):
    conservar_id: int
    unir_ids: list[int] = Field(min_length=1)


class UnificarResponse(BaseModel):
    persona: PersonaListItem
    signos_movidos: int
    kits_movidos: int
    duplicados_descartados: int


class DistintasRequest(BaseModel):
    # Parejas de ids que NO son la misma persona (no se vuelven a proponer juntas).
    pares: list[tuple[int, int]] = Field(min_length=1)
