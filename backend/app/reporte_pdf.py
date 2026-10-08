"""Genera el PDF de signos vitales de todas las personas.

Por persona: apellido, nombre, edad, resumen de kits entregados y tres gráficos
(presión arterial, frecuencia cardíaca y SpO2) a lo largo del tiempo.

Es código sincrónico (matplotlib + reportlab): el router lo llama en un thread
aparte para no frenar el servidor. Se usa la API orientada a objetos de
matplotlib (Figure + FigureCanvasAgg) y no pyplot, que no es segura entre threads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO

import matplotlib

matplotlib.use("Agg")

from matplotlib.backends.backend_agg import FigureCanvasAgg  # noqa: E402
from matplotlib.dates import AutoDateLocator, DateFormatter  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

ROJO = "#e3000f"
CELESTE = "#17a2b8"
NARANJA = "#f5a623"
AMARILLO = "#d4a017"
GRIS = "#555555"


@dataclass
class RegistroPDF:
    fecha: date
    presion_arterial: str | None
    frecuencia_cardiaca: int | None
    oxigenacion_sangre: float | None


@dataclass
class KitPDF:
    tipo: str
    fecha_entrega: date


@dataclass
class PersonaPDF:
    nombre: str
    apellido: str
    fecha_nacimiento: date | None
    registros: list[RegistroPDF] = field(default_factory=list)
    kits: list[KitPDF] = field(default_factory=list)


def calcular_edad(nacimiento: date | None, hoy: date) -> int | None:
    if nacimiento is None:
        return None
    return hoy.year - nacimiento.year - ((hoy.month, hoy.day) < (nacimiento.month, nacimiento.day))


def _parsear_pa(valor: str | None) -> tuple[int | None, int | None]:
    # "0/0" es lo que guarda la carga masiva cuando no se tomó la presión: no se grafica.
    if not valor or "/" not in valor:
        return None, None
    partes = valor.split("/")
    try:
        sistolica = int(float(partes[0])) or None
        diastolica = int(float(partes[1])) or None
    except ValueError:
        return None, None
    return sistolica, diastolica


def _fmt_fecha(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def resumen_kits(kits: list[KitPDF]) -> str:
    if not kits:
        return "ninguno"
    por_tipo: dict[str, list[date]] = {}
    for kit in kits:
        por_tipo.setdefault(kit.tipo, []).append(kit.fecha_entrega)
    partes = []
    for tipo in sorted(por_tipo):
        fechas = por_tipo[tipo]
        partes.append(f"{tipo} × {len(fechas)} (último {_fmt_fecha(max(fechas))})")
    return " · ".join(partes)


def _serie(fechas: list[date], valores: list) -> tuple[list[date], list]:
    pares = [(f, v) for f, v in zip(fechas, valores) if v is not None]
    return [p[0] for p in pares], [p[1] for p in pares]


def _grafico_persona(registros: list[RegistroPDF]) -> BytesIO:
    registros = sorted(registros, key=lambda r: r.fecha)
    fechas = [r.fecha for r in registros]
    pa = [_parsear_pa(r.presion_arterial) for r in registros]
    sistolica = [p[0] for p in pa]
    diastolica = [p[1] for p in pa]
    fc = [r.frecuencia_cardiaca or None for r in registros]
    spo2 = [r.oxigenacion_sangre or None for r in registros]

    fig = Figure(figsize=(7.2, 1.95), dpi=150)
    FigureCanvasAgg(fig)
    axes = fig.subplots(1, 3)

    paneles = [
        ("Presión arterial (mmHg)", [("Sistólica", sistolica, NARANJA, "-"), ("Diastólica", diastolica, AMARILLO, "--")]),
        ("Frec. cardíaca (lpm)", [("FC", fc, ROJO, "-")]),
        ("SpO2 (%)", [("SpO2", spo2, CELESTE, "-")]),
    ]
    for ax, (titulo, series) in zip(axes, paneles):
        hay_datos = False
        for etiqueta, valores, color, estilo in series:
            xs, ys = _serie(fechas, valores)
            if xs:
                hay_datos = True
                ax.plot(xs, ys, estilo, color=color, linewidth=1.4, marker="o", markersize=3, label=etiqueta)
                for x, y in ((xs[-1], ys[-1]),):
                    ax.annotate(f"{y:g}", (x, y), textcoords="offset points", xytext=(0, 4),
                                ha="center", fontsize=6, color=color)
        ax.set_title(titulo, fontsize=7.5, color="#222222", pad=3)
        ax.tick_params(labelsize=6, length=2, colors=GRIS)
        ax.grid(True, color="#e5e5e5", linewidth=0.5)
        for lado in ("top", "right"):
            ax.spines[lado].set_visible(False)
        for lado in ("left", "bottom"):
            ax.spines[lado].set_color("#bbbbbb")
        if hay_datos:
            ax.xaxis.set_major_locator(AutoDateLocator(minticks=2, maxticks=4))
            ax.xaxis.set_major_formatter(DateFormatter("%d/%m/%y"))
            ax.margins(x=0.08, y=0.25)
            if len(series) > 1:
                ax.legend(fontsize=5.5, frameon=False, loc="best", handlelength=1.6)
        else:
            ax.set_xticks([])
            ax.set_yticks([])
            ax.text(0.5, 0.5, "sin datos", ha="center", va="center", fontsize=7, color="#999999",
                    transform=ax.transAxes)

    fig.tight_layout(pad=0.4, w_pad=1.2)
    buffer = BytesIO()
    fig.savefig(buffer, format="png")
    buffer.seek(0)
    return buffer


def generar_pdf(personas: list[PersonaPDF], ahora: datetime | None = None) -> bytes:
    ahora = ahora or datetime.now()
    hoy = ahora.date()

    estilos = getSampleStyleSheet()
    titulo = ParagraphStyle("titulo", parent=estilos["Title"], fontSize=15, spaceAfter=2, textColor=colors.HexColor(ROJO))
    subtitulo = ParagraphStyle("sub", parent=estilos["Normal"], fontSize=8.5, textColor=colors.HexColor(GRIS),
                               alignment=1, spaceAfter=6)
    nombre_st = ParagraphStyle("nombre", parent=estilos["Normal"], fontName="Helvetica-Bold", fontSize=10.5, leading=13)
    detalle_st = ParagraphStyle("detalle", parent=estilos["Normal"], fontSize=8.5, leading=11,
                                textColor=colors.HexColor("#333333"))
    vacio_st = ParagraphStyle("vacio", parent=detalle_st, textColor=colors.HexColor("#999999"), fontName="Helvetica-Oblique")

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.4 * cm,
        bottomMargin=1.4 * cm,
        title="SISVAP - Signos vitales",
        author="Cruz Roja San Rafael",
    )
    ancho = doc.width

    historia = [
        Paragraph("Signos vitales — Cruz Roja San Rafael", titulo),
        Paragraph(
            f"Generado el {ahora.strftime('%d/%m/%Y %H:%M')} · {len(personas)} persona(s) · "
            "Documento confidencial",
            subtitulo,
        ),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor(ROJO), spaceAfter=6),
    ]

    personas = sorted(personas, key=lambda p: (p.apellido.casefold(), p.nombre.casefold()))
    for persona in personas:
        edad = calcular_edad(persona.fecha_nacimiento, hoy)
        edad_txt = f"{edad} años" if edad is not None else "edad s/d"
        bloque = [
            Paragraph(f"{persona.apellido.upper()}, {persona.nombre} &nbsp;·&nbsp; {edad_txt}", nombre_st),
            Paragraph(f"<b>Kits:</b> {resumen_kits(persona.kits)}", detalle_st),
        ]
        if persona.registros:
            n = len(persona.registros)
            ultima = max(r.fecha for r in persona.registros)
            bloque.append(Paragraph(f"<b>Controles:</b> {n} (último {_fmt_fecha(ultima)})", detalle_st))
            png = _grafico_persona(persona.registros)
            bloque.append(Spacer(1, 2))
            bloque.append(Image(png, width=ancho, height=ancho * 1.95 / 7.2))
        else:
            bloque.append(Paragraph("Sin registros de signos vitales.", vacio_st))
        bloque.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#cccccc"),
                                 spaceBefore=4, spaceAfter=6))
        historia.append(KeepTogether(bloque))

    if not personas:
        historia.append(Paragraph("No hay personas cargadas.", vacio_st))

    def pie(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#888888"))
        canvas.drawString(doc_.leftMargin, 0.8 * cm, "SISVAP · Cruz Roja San Rafael · Confidencial")
        canvas.drawRightString(A4[0] - doc_.rightMargin, 0.8 * cm, f"Página {doc_.page}")
        canvas.restoreState()

    doc.build(historia, onFirstPage=pie, onLaterPages=pie)
    return buffer.getvalue()
