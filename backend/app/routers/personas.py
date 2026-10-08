import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_admin
from ..database import get_session
from ..models import Kit, Operativo, Persona, PersonasDistintas, RegistroSignosVitales
from ..repetidos import grupos_repetidos
from ..revision import revisar_filas
from ..schemas import (
    ActualizacionesRequest,
    ActualizacionesResponse,
    DistintasRequest,
    GrupoRepetidos,
    BulkPreviewResponse,
    FilaInvalida,
    PersonaBulkRequest,
    PersonaBulkResponse,
    PersonaBulkRow,
    PersonaCreate,
    PersonaListItem,
    PersonaRead,
    PersonaRepetida,
    PersonaUpdate,
    SignosRead,
    UnificarRequest,
    UnificarResponse,
    format_validation_errors,
)

router = APIRouter(prefix="/personas", tags=["personas"])


def _normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFD", value.casefold())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").strip()


def _detalle_dni_en_uso(dni: str, persona: Persona) -> str:
    return f"El DNI {dni} ya lo tiene {persona.nombre} {persona.apellido}."


async def _persona_con_dni(dni: str | None, db: AsyncSession, excluir_id: int | None = None) -> Persona | None:
    if not dni:
        return None
    consulta = select(Persona).where(Persona.dni == dni)
    if excluir_id is not None:
        consulta = consulta.where(Persona.id != excluir_id)
    return (await db.execute(consulta)).scalars().first()


@router.post("", response_model=PersonaRead, status_code=201, dependencies=[Depends(get_current_user)])
async def crear_persona(persona_in: PersonaCreate, db: AsyncSession = Depends(get_session)):
    existente = await _persona_con_dni(persona_in.dni, db)
    if existente is not None:
        raise HTTPException(status_code=400, detail=_detalle_dni_en_uso(persona_in.dni, existente))
    persona = Persona(**persona_in.model_dump())
    db.add(persona)
    await db.commit()
    await db.refresh(persona)
    return persona


@router.post("/bulk/preview", response_model=BulkPreviewResponse)
async def revisar_personas_bulk(
    bulk_request: PersonaBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revisión previa de la planilla de personas (no guarda nada): misma lógica que signos y kits.
    Dice quién ya existe (y qué datos se le pueden completar) y a quién hay que crear."""
    personas = (await db.execute(select(Persona))).scalars().all()
    validas: list[tuple[int, PersonaBulkRow]] = []
    invalidas: list[FilaInvalida] = []
    for index, raw_row in enumerate(bulk_request.rows, start=1):
        fila = index
        if isinstance(raw_row, dict) and str(raw_row.get("fila") or "").isdigit():
            fila = int(raw_row["fila"])
        if _fila_vacia(raw_row):
            invalidas.append(FilaInvalida(fila=fila, error="fila vacía o sin datos suficientes"))
            continue
        try:
            row = PersonaBulkRow.model_validate(raw_row)
        except ValidationError as exc:
            invalidas.append(FilaInvalida(fila=fila, error=f"datos inválidos ({format_validation_errors(exc)})"))
            continue
        if not row.tiene_datos_persona():
            invalidas.append(FilaInvalida(fila=fila, error="falta la persona: completar Nombre y Apellido, DNI o ambos"))
            continue
        validas.append((fila, row))
    return BulkPreviewResponse(
        total_filas=len(bulk_request.rows),
        identificadores=revisar_filas(validas, personas),
        invalidas=invalidas,
    )


def _fila_vacia(raw_row) -> bool:
    return raw_row is None or (
        isinstance(raw_row, dict)
        and not any(value is not None and str(value).strip() != "" for key, value in raw_row.items() if key != "fila")
    )


@router.post("/bulk", response_model=PersonaBulkResponse, status_code=200)
async def cargar_personas_bulk(
    bulk_request: PersonaBulkRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Da de alta las personas recibidas (las que se confirmaron en la revisión previa).

    El DNI es opcional: si no viene, la persona queda sin DNI y se puede completar después.
    Se rechaza un DNI que ya tenga otra persona y las filas repetidas dentro del mismo pedido.
    """
    ok_count = 0
    errores: list[str] = []
    creadas: list[dict] = []
    vistos_dni: set[str] = set()
    vistos_nombre: set[tuple[str, str]] = set()

    if not bulk_request.rows:
        return {"ok": 0, "total": 0, "errores": ["No se recibieron filas para procesar."]}

    for index, raw_row in enumerate(bulk_request.rows, start=1):
        if _fila_vacia(raw_row):
            errores.append(f"Fila {index}: fila vacía o sin datos suficientes")
            continue
        try:
            row = PersonaBulkRow.model_validate(raw_row)
        except ValidationError as exc:
            errores.append(f"Fila {index}: datos inválidos ({format_validation_errors(exc)})")
            continue

        nombre = row.nombre or ""
        apellido = row.apellido or ""
        if not nombre:
            errores.append(f"Fila {index}: falta el nombre ({row.etiqueta or 'sin datos'})")
            continue

        if row.dni:
            if row.dni in vistos_dni:
                errores.append(f"Fila {index}: el DNI {row.dni} está repetido en la carga.")
                continue
            existente = await _persona_con_dni(row.dni, db)
            if existente is not None:
                errores.append(f"Fila {index}: {_detalle_dni_en_uso(row.dni, existente)}")
                continue
        else:
            clave = (_normalize_text(nombre), _normalize_text(apellido))
            if clave in vistos_nombre:
                errores.append(f"Fila {index}: {nombre} {apellido} está repetida en la carga.")
                continue
            vistos_nombre.add(clave)
        if row.dni:
            vistos_dni.add(row.dni)

        persona = Persona(
            nombre=nombre,
            apellido=apellido,
            dni=row.dni,
            fecha_nacimiento=row.fecha_nacimiento,
            genero=row.genero,
            situacion_de_calle=row.situacion_de_calle,
        )
        db.add(persona)
        await db.flush()
        creadas.append({"fila": index, "id": persona.id, "nombre": nombre, "apellido": apellido, "dni": row.dni})
        ok_count += 1

    await db.commit()
    return {"ok": ok_count, "total": len(bulk_request.rows), "errores": errores, "creadas": creadas}


@router.post("/actualizar", response_model=ActualizacionesResponse)
async def actualizar_datos_personas(
    request: ActualizacionesRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Completa o actualiza el DNI y/o la fecha de nacimiento de personas existentes
    (lo que se confirmó en la revisión de una carga masiva)."""
    ok = 0
    errores: list[str] = []
    for cambio in request.cambios:
        persona = await db.get(Persona, cambio.persona_id)
        if persona is None:
            errores.append(f"Persona #{cambio.persona_id}: ya no existe")
            continue
        nombre = f"{persona.nombre} {persona.apellido}"
        if cambio.dni and cambio.dni != persona.dni:
            otra = await _persona_con_dni(cambio.dni, db, excluir_id=persona.id)
            if otra is not None:
                errores.append(f"{nombre}: no se actualizó el DNI. {_detalle_dni_en_uso(cambio.dni, otra)}")
            else:
                persona.dni = cambio.dni
        if cambio.fecha_nacimiento:
            persona.fecha_nacimiento = cambio.fecha_nacimiento
        await db.flush()
        ok += 1
    await db.commit()
    return {"ok": ok, "errores": errores}


@router.get("", response_model=list[PersonaListItem], dependencies=[Depends(get_current_user)])
async def listar_personas(
    q: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
):
    """Lista personas con el total de signos tomados y kits entregados.

    La búsqueda separa el texto en palabras: cada palabra tiene que aparecer en el
    nombre, el apellido o el comienzo del DNI, sin importar mayúsculas ni tildes.
    Así "juan perez", "Pérez Juan", "2776" o "juan" encuentran a la persona.
    (Se filtra en Python porque SQLite no compara sin tildes; el padrón es chico.)
    """
    total_signos = (
        select(func.count(RegistroSignosVitales.id))
        .where(RegistroSignosVitales.persona_id == Persona.id)
        .correlate(Persona)
        .scalar_subquery()
    )
    total_kits = (
        select(func.count(Kit.id)).where(Kit.persona_id == Persona.id).correlate(Persona).scalar_subquery()
    )
    consulta = select(Persona, total_signos.label("total_signos"), total_kits.label("total_kits")).order_by(
        Persona.apellido, Persona.nombre
    )
    resultado = await db.execute(consulta)

    terminos = [_normalize_text(t) for t in (q or "").split() if t.strip()]

    def coincide(persona: Persona) -> bool:
        if not terminos:
            return True
        nombre = _normalize_text(persona.nombre)
        apellido = _normalize_text(persona.apellido)
        for termino in terminos:
            dni_termino = re.sub(r"[\s.-]", "", termino)
            if termino in nombre or termino in apellido:
                continue
            if dni_termino and persona.dni and persona.dni.startswith(dni_termino):
                continue
            return False
        return True

    personas = []
    for persona, signos, kits in resultado.all():
        if not coincide(persona):
            continue
        item = PersonaListItem.model_validate(persona)
        item.total_signos = signos or 0
        item.total_kits = kits or 0
        personas.append(item)
        if limit and len(personas) >= limit:
            break
    return personas


async def _totales(db: AsyncSession) -> tuple[dict[int, int], dict[int, int]]:
    signos = dict(
        (await db.execute(select(RegistroSignosVitales.persona_id, func.count()).group_by(RegistroSignosVitales.persona_id))).all()
    )
    kits = dict((await db.execute(select(Kit.persona_id, func.count()).group_by(Kit.persona_id))).all())
    return signos, kits


@router.get("/repetidos", response_model=list[GrupoRepetidos], dependencies=[Depends(require_admin)])
async def personas_repetidas(db: AsyncSession = Depends(get_session)):
    """Grupos de registros que, por el nombre, podrían ser la misma persona."""
    personas = (await db.execute(select(Persona).order_by(Persona.apellido, Persona.nombre))).scalars().all()
    distintas = {(a, b) for a, b in (await db.execute(select(PersonasDistintas.persona_a_id, PersonasDistintas.persona_b_id))).all()}
    total_signos, total_kits = await _totales(db)

    respuesta = []
    for parejas in grupos_repetidos(list(personas), distintas):
        miembros: dict[int, PersonaRepetida] = {}
        for a, b, puntaje in parejas:
            for yo, otro in ((a, b), (b, a)):
                if yo.id not in miembros:
                    item = PersonaRepetida.model_validate(yo)
                    item.total_signos = total_signos.get(yo.id, 0)
                    item.total_kits = total_kits.get(yo.id, 0)
                    miembros[yo.id] = item
                miembros[yo.id].parecida_a.append(otro.id)
                miembros[yo.id].similitud_max = max(miembros[yo.id].similitud_max, puntaje)
        lista = sorted(miembros.values(), key=lambda p: (p.apellido.casefold(), p.nombre.casefold()))
        sugerida = max(lista, key=lambda p: (bool(p.dni), bool(p.fecha_nacimiento), p.total_signos + p.total_kits, -p.id))
        respuesta.append(GrupoRepetidos(personas=lista, sugerida_id=sugerida.id))
    respuesta.sort(key=lambda g: (g.personas[0].apellido.casefold(), g.personas[0].nombre.casefold()))
    return respuesta


@router.post("/unificar", response_model=UnificarResponse, dependencies=[Depends(require_admin)])
async def unificar_personas(pedido: UnificarRequest, db: AsyncSession = Depends(get_session)):
    """Une varios registros de la misma persona en uno solo (el que se elige conservar).

    Los signos y kits pasan al registro conservado; si quedan mediciones o entregas idénticas
    (misma fecha y mismos valores), se deja una sola. Los datos que le falten al registro
    conservado (DNI, fecha de nacimiento, género) se toman de los otros. Los otros se borran.
    """
    unir_ids = sorted({i for i in pedido.unir_ids if i != pedido.conservar_id})
    if not unir_ids:
        raise HTTPException(status_code=400, detail="Elegí al menos otro registro para unificar.")
    conservar = await _persona_o_404(pedido.conservar_id, db)
    otros = (await db.execute(select(Persona).where(Persona.id.in_(unir_ids)).order_by(Persona.id))).scalars().all()
    if len(otros) != len(unir_ids):
        raise HTTPException(status_code=404, detail="Alguna de las personas ya no existe. Recargá la página.")

    con_dni = [p for p in [conservar, *otros] if p.dni]
    if len({p.dni for p in con_dni}) > 1:
        detalle = ", ".join(f"{p.nombre} {p.apellido}: {p.dni}" for p in con_dni)
        raise HTTPException(status_code=400, detail=f"No se pueden unificar: tienen DNI distintos ({detalle}).")

    # Completar lo que le falte al registro que se conserva.
    dni = conservar.dni or (con_dni[0].dni if con_dni else None)
    for otro in otros:
        otro.dni = None  # libera el DNI (es único) antes de pasárselo al conservado
        conservar.fecha_nacimiento = conservar.fecha_nacimiento or otro.fecha_nacimiento
        conservar.genero = conservar.genero or otro.genero
        conservar.situacion_de_calle = conservar.situacion_de_calle or otro.situacion_de_calle
    await db.flush()
    conservar.dni = dni

    signos_movidos = (
        await db.execute(
            update(RegistroSignosVitales).where(RegistroSignosVitales.persona_id.in_(unir_ids)).values(persona_id=conservar.id)
        )
    ).rowcount
    kits_movidos = (await db.execute(update(Kit).where(Kit.persona_id.in_(unir_ids)).values(persona_id=conservar.id))).rowcount

    # Si la misma medición o entrega quedó cargada dos veces (en los dos registros), se deja una.
    descartados = 0
    vistos = set()
    for r in (
        await db.execute(select(RegistroSignosVitales).where(RegistroSignosVitales.persona_id == conservar.id).order_by(RegistroSignosVitales.id))
    ).scalars():
        clave = (r.fecha, r.presion_arterial, r.frecuencia_cardiaca, r.oxigenacion_sangre)
        if clave in vistos:
            await db.delete(r)
            descartados += 1
        vistos.add(clave)
    vistos = set()
    for k in (await db.execute(select(Kit).where(Kit.persona_id == conservar.id).order_by(Kit.id))).scalars():
        clave = (k.tipo, k.fecha_entrega)
        if clave in vistos:
            await db.delete(k)
            descartados += 1
        vistos.add(clave)

    await db.execute(
        delete(PersonasDistintas).where(
            or_(PersonasDistintas.persona_a_id.in_(unir_ids), PersonasDistintas.persona_b_id.in_(unir_ids))
        )
    )
    await db.flush()
    for otro in otros:
        db.expunge(otro)  # se borran con SQL directo: así el ORM no arrastra signos/kits en cascada
    await db.execute(delete(Persona).where(Persona.id.in_(unir_ids)))
    await db.commit()

    return {
        "persona": await obtener_persona(conservar.id, db),
        "signos_movidos": signos_movidos,
        "kits_movidos": kits_movidos,
        "duplicados_descartados": descartados,
    }


@router.post("/distintas", dependencies=[Depends(require_admin)])
async def marcar_distintas(pedido: DistintasRequest, db: AsyncSession = Depends(get_session)):
    """Marca parejas como "no son la misma persona" para no volver a proponerlas."""
    existentes = {(a, b) for a, b in (await db.execute(select(PersonasDistintas.persona_a_id, PersonasDistintas.persona_b_id))).all()}
    nuevas = 0
    for a, b in pedido.pares:
        par = (min(a, b), max(a, b))
        if a == b or par in existentes:
            continue
        db.add(PersonasDistintas(persona_a_id=par[0], persona_b_id=par[1]))
        existentes.add(par)
        nuevas += 1
    await db.commit()
    return {"ok": nuevas}


async def _persona_o_404(persona_id: int, db: AsyncSession) -> Persona:
    persona = await db.get(Persona, persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    return persona


@router.get("/{persona_id}", response_model=PersonaListItem, dependencies=[Depends(get_current_user)])
async def obtener_persona(persona_id: int, db: AsyncSession = Depends(get_session)):
    persona = await _persona_o_404(persona_id, db)
    item = PersonaListItem.model_validate(persona)
    item.total_signos = (
        await db.execute(select(func.count(RegistroSignosVitales.id)).where(RegistroSignosVitales.persona_id == persona_id))
    ).scalar_one()
    item.total_kits = (await db.execute(select(func.count(Kit.id)).where(Kit.persona_id == persona_id))).scalar_one()
    return item


@router.patch("/{persona_id}", response_model=PersonaListItem, dependencies=[Depends(get_current_user)])
async def editar_persona(persona_id: int, cambios: PersonaUpdate, db: AsyncSession = Depends(get_session)):
    """Edición a mano (DNI, fecha de nacimiento, nombre, etc.). Solo cambia lo que se manda."""
    persona = await _persona_o_404(persona_id, db)
    datos = cambios.model_dump(exclude_unset=True)
    for obligatorio in ("nombre", "apellido", "situacion_de_calle"):
        if obligatorio in datos and datos[obligatorio] is None:
            del datos[obligatorio]
    if datos.get("dni"):
        otra = await _persona_con_dni(datos["dni"], db, excluir_id=persona.id)
        if otra is not None:
            raise HTTPException(status_code=400, detail=_detalle_dni_en_uso(datos["dni"], otra))
    for campo, valor in datos.items():
        setattr(persona, campo, valor)
    await db.commit()
    return await obtener_persona(persona_id, db)


@router.get("/{persona_id}/historial", response_model=list[SignosRead], dependencies=[Depends(require_admin)])
async def historial_persona(persona_id: int, db: AsyncSession = Depends(get_session)):
    persona = await _persona_o_404(persona_id, db)
    consulta = (
        select(RegistroSignosVitales)
        .options(selectinload(RegistroSignosVitales.persona), selectinload(RegistroSignosVitales.operativo))
        .where(RegistroSignosVitales.persona_id == persona.id)
        .order_by(RegistroSignosVitales.fecha.desc(), RegistroSignosVitales.hora.desc())
    )
    resultado = await db.execute(consulta)
    return resultado.scalars().all()
