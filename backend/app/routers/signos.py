from datetime import date, datetime, time
import re
import unicodedata
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Operativo, Persona, RegistroSignosVitales
from ..matching import candidatos, es_coincidencia_exacta, es_dni, limpiar_dni, normalizar, separar_nombre_apellido, similitud
from ..schemas import (
    FilaInvalida,
    IdentificadorRevision,
    PersonaCandidata,
    SignosBulkPreviewResponse,
    SignosBulkRequest,
    SignosBulkResponse,
    SignosBulkRow,
    SignosCreate,
    SignosRead,
    format_validation_errors,
)

router = APIRouter(prefix="/signos", tags=["signos"])


async def _resolve_operativo(operativo_id: Optional[int], lugar_custom: Optional[str], db: AsyncSession) -> Operativo:
    if operativo_id is not None:
        operativo_res = await db.execute(select(Operativo).where(Operativo.id == operativo_id))
        operativo = operativo_res.scalar_one_or_none()
        if not operativo:
            raise HTTPException(status_code=404, detail="Operativo no encontrado")
        return operativo

    if lugar_custom:
        operativo_res = await db.execute(select(Operativo).where(Operativo.lugar == lugar_custom))
        operativo = operativo_res.scalar_one_or_none()
        if operativo:
            return operativo
        operativo = Operativo(lugar=lugar_custom, dia_semana="Custom", hora=time(0, 0), activo=False)
        db.add(operativo)
        await db.flush()
        return operativo

    operativo_res = await db.execute(select(Operativo).where(Operativo.activo.is_(True)))
    operativo = operativo_res.scalar_one_or_none()
    if not operativo:
        raise HTTPException(status_code=500, detail="No existe un operativo activo")
    return operativo


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").strip()


async def _find_persona_by_identificador(identifier: str, db: AsyncSession) -> Persona:
    identifier = identifier.strip()
    identifier_clean = re.sub(r"[\s.-]", "", identifier)
    if re.fullmatch(r"^\d{6,9}$", identifier_clean):
        persona_res = await db.execute(
            select(Persona).where(or_(Persona.dni == identifier, Persona.dni == identifier_clean))
        )
        return persona_res.scalar_one_or_none()

    parts = [part.strip() for part in re.split(r"\s+", identifier) if part.strip()]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="El identificador debe ser DNI o Nombre y Apellido completos.")

    nombre = " ".join(parts[:-1])
    apellido = parts[-1]
    persona_res = await db.execute(select(Persona))
    personas = persona_res.scalars().all()
    matches = [
        persona for persona in personas
        if _normalize_name(persona.nombre) == _normalize_name(nombre)
        and _normalize_name(persona.apellido) == _normalize_name(apellido)
    ]
    if len(matches) > 1:
        raise HTTPException(status_code=400, detail="Identificador ambiguo: existe más de una persona con ese nombre y apellido.")
    return matches[0] if matches else None


@router.post("", response_model=SignosRead, status_code=201)
async def crear_signos(signos_in: SignosCreate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    persona_res = await db.execute(select(Persona).where(Persona.dni == signos_in.dni))
    persona = persona_res.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")

    operativo = await _resolve_operativo(signos_in.operativo_id, signos_in.lugar_custom, db)
    registro = RegistroSignosVitales(
        persona_id=persona.id,
        operativo_id=operativo.id,
        fecha=signos_in.fecha or date.today(),
        hora=datetime.now().time().replace(microsecond=0),
        presion_arterial=signos_in.presion_arterial,
        frecuencia_cardiaca=signos_in.frecuencia_cardiaca,
        oxigenacion_sangre=signos_in.oxigenacion_sangre,
    )
    db.add(registro)
    await db.commit()
    resultado = await db.execute(
        select(RegistroSignosVitales)
        .options(
            selectinload(RegistroSignosVitales.persona),
            selectinload(RegistroSignosVitales.operativo),
        )
        .where(RegistroSignosVitales.id == registro.id)
    )
    return resultado.scalar_one()


def _fila_vacia(raw_row) -> bool:
    return raw_row is None or (
        isinstance(raw_row, dict)
        and not any(value is not None and str(value).strip() != "" for value in raw_row.values())
    )


def _parsear_fila(raw_row) -> tuple[SignosBulkRow | None, tuple | None, str | None]:
    """Valida una fila. Devuelve (fila, (pa, fc, spo2), error)."""
    if _fila_vacia(raw_row):
        return None, None, "fila vacía o sin datos suficientes"
    try:
        row = SignosBulkRow.model_validate(raw_row)
    except ValidationError as exc:
        return None, None, f"datos inválidos ({format_validation_errors(exc)})"
    try:
        partes = [part.strip() for part in row.signos.split("-")]
        if len(partes) != 3:
            return None, None, "formato de signos inválido (esperado PA-FC-SpO2)"
        presion_arterial = partes[0] if partes[0] else "0/0"
        frecuencia_cardiaca = int(partes[1]) if partes[1] else 0
        oxigenacion_sangre = float(partes[2]) if partes[2] else 0.0
    except Exception:
        return None, None, "formato de signos inválido"
    return row, (presion_arterial, frecuencia_cardiaca, oxigenacion_sangre), None


def _numero_fila(row: SignosBulkRow | None, raw_row, index: int) -> int:
    if row is not None and row.fila:
        return row.fila
    if isinstance(raw_row, dict) and str(raw_row.get("fila") or "").isdigit():
        return int(raw_row["fila"])
    return index


def _candidata(persona: Persona, puntaje: float = 1.0) -> PersonaCandidata:
    return PersonaCandidata(
        id=persona.id, nombre=persona.nombre, apellido=persona.apellido, dni=persona.dni, similitud=puntaje
    )


@router.post("/bulk/preview", response_model=SignosBulkPreviewResponse)
async def revisar_signos_bulk(
    bulk_request: SignosBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revisión previa (no guarda nada): agrupa las filas por identificador y dice, para
    cada uno, si la persona existe, si hay personas parecidas para confirmar o si no existe."""
    personas = (await db.execute(select(Persona))).scalars().all()
    grupos: dict[str, dict] = {}
    invalidas: list[FilaInvalida] = []

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, _, error = _parsear_fila(raw_row)
        fila = _numero_fila(row, raw_row, index)
        if error:
            invalidas.append(FilaInvalida(fila=fila, error=error))
            continue
        identificador = row.identificador.strip()
        clave = limpiar_dni(identificador) if es_dni(identificador) else normalizar(identificador)
        grupo = grupos.setdefault(clave, {"identificador": identificador, "filas": []})
        grupo["filas"].append(fila)

    revision: list[IdentificadorRevision] = []
    for grupo in grupos.values():
        identificador = grupo["identificador"]
        nombre_sug, apellido_sug = separar_nombre_apellido(identificador)
        item = IdentificadorRevision(
            identificador=identificador,
            filas=grupo["filas"],
            estado="no_encontrada",
            nombre_sugerido=nombre_sug,
            apellido_sugerido=apellido_sug,
        )
        if es_dni(identificador):
            dni = limpiar_dni(identificador)
            persona = next((p for p in personas if p.dni in (dni, identificador)), None)
            if persona:
                item.estado = "exacta"
                item.persona = _candidata(persona)
            else:
                item.nombre_sugerido, item.apellido_sugerido = "", ""
        else:
            exactas = [p for p in personas if es_coincidencia_exacta(identificador, p)]
            if len(exactas) == 1:
                item.estado = "exacta"
                item.persona = _candidata(exactas[0])
            elif len(exactas) > 1:
                item.estado = "ambigua"
                item.candidatos = [_candidata(p) for p in exactas]
            else:
                parecidas = candidatos(identificador, personas)
                if parecidas:
                    item.estado = "sugerencia"
                    item.candidatos = [_candidata(p, puntaje) for p, puntaje in parecidas]
        revision.append(item)

    # Entre las que no existen, marcar las que parecen la misma persona escrita distinto.
    no_encontradas = [r for r in revision if r.estado == "no_encontrada" and not es_dni(r.identificador)]
    for i, item in enumerate(no_encontradas):
        for anterior in no_encontradas[:i]:
            if anterior.parecido_a:
                continue
            falsa = SimpleNamespace(nombre=anterior.nombre_sugerido, apellido=anterior.apellido_sugerido)
            if similitud(item.identificador, falsa) >= 0.8:
                item.parecido_a = anterior.identificador
                break

    return SignosBulkPreviewResponse(total_filas=len(bulk_request.rows), identificadores=revision, invalidas=invalidas)


@router.post("/bulk", response_model=SignosBulkResponse, status_code=201)
async def cargar_signos_bulk(
    bulk_request: SignosBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ok_count = 0
    errores: list[str] = []

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        row, valores, error = _parsear_fila(raw_row)
        fila = _numero_fila(row, raw_row, index)
        if error:
            errores.append(f"Fila {fila}: {error}")
            continue
        presion_arterial, frecuencia_cardiaca, oxigenacion_sangre = valores

        if row.persona_id is not None:
            persona = (await db.execute(select(Persona).where(Persona.id == row.persona_id))).scalar_one_or_none()
            if not persona:
                errores.append(f"Fila {fila}: la persona seleccionada ya no existe")
                continue
        else:
            try:
                persona = await _find_persona_by_identificador(row.identificador, db)
            except HTTPException as exc:
                errores.append(f"Fila {fila}: {exc.detail}")
                continue

            if not persona:
                errores.append(f"Fila {fila}: persona no encontrada para '{row.identificador}'")
                continue

        operativo_id = row.operativo_id if row.operativo_id is not None else bulk_request.operativo_id
        lugar_custom = row.lugar_custom if row.lugar_custom is not None else bulk_request.lugar_custom
        try:
            operativo = await _resolve_operativo(operativo_id, lugar_custom, db)
        except HTTPException as exc:
            errores.append(f"Fila {fila}: {exc.detail}")
            continue

        duplicate_res = await db.execute(
            select(RegistroSignosVitales).where(
                and_(
                    RegistroSignosVitales.persona_id == persona.id,
                    RegistroSignosVitales.fecha == row.fecha,
                    RegistroSignosVitales.presion_arterial == presion_arterial,
                    RegistroSignosVitales.frecuencia_cardiaca == frecuencia_cardiaca,
                    RegistroSignosVitales.oxigenacion_sangre == oxigenacion_sangre,
                )
            )
        )
        if duplicate_res.scalars().first():
            errores.append(
                f"Fila {fila}: registro duplicado para persona {persona.nombre} {persona.apellido} en fecha {row.fecha}"
            )
            continue

        registro = RegistroSignosVitales(
            persona_id=persona.id,
            operativo_id=operativo.id,
            fecha=row.fecha,
            hora=datetime.now().time().replace(microsecond=0),
            presion_arterial=presion_arterial,
            frecuencia_cardiaca=frecuencia_cardiaca,
            oxigenacion_sangre=oxigenacion_sangre,
        )
        db.add(registro)
        await db.flush()
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "errores": errores}


@router.get("/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_signos(
    q: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    db: AsyncSession = Depends(get_session),
):
    consulta = select(RegistroSignosVitales).options(
        selectinload(RegistroSignosVitales.persona), selectinload(RegistroSignosVitales.operativo)
    )
    if q:
        filtro = f"%{q}%"
        consulta = consulta.join(Persona).where(
            or_(Persona.dni == q, Persona.nombre.ilike(filtro), Persona.apellido.ilike(filtro))
        )
    if desde:
        consulta = consulta.where(RegistroSignosVitales.fecha >= desde)
    if hasta:
        consulta = consulta.where(RegistroSignosVitales.fecha <= hasta)
    consulta = consulta.order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    resultado = await db.execute(consulta)
    return resultado.scalars().all()