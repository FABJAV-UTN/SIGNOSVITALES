"""Genera el PDF de signos vitales de las personas elegidas, para un rango de fechas.

Una hoja A4 apaisada por persona: apellido, nombre, edad, kits entregados en el período
y tres gráficos grandes (presión arterial, frecuencia cardíaca y SpO2) con la fecha exacta
de cada control en el eje y el valor anotado en cada punto.

Es código sincrónico (matplotlib + reportlab): el router lo llama en un thread aparte para
no frenar el servidor. Se usa la API orientada a objetos de matplotlib (Figure +
FigureCanvasAgg) y no pyplot, que no es segura entre threads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from io import BytesIO

import matplotlib

matplotlib.use("Agg")

from matplotlib.backends.backend_agg import FigureCanvasAgg  # noqa: E402
from matplotlib.dates import DateFormatter, date2num  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4, landscape  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle  # noqa: E402

ROJO = "#e3000f"
CELESTE = "#17a2b8"
NARANJA = "#f5a623"
AMARILLO = "#c9940a"
GRIS = "#555555"
PAGINA = landscape(A4)


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
    """'PPAAS × 2 (03/09/2026, 17/09/2026) · ABRIGO × 1 (10/09/2026)' o 'ninguno'."""
    if not kits:
        return "ninguno"
    por_tipo: dict[str, list[date]] = {}
    for kit in kits:
        por_tipo.setdefault(kit.tipo, []).append(kit.fecha_entrega)
    partes = []
    for tipo in sorted(por_tipo):
        fechas = sorted(por_tipo[tipo])
        partes.append(f"{tipo} × {len(fechas)} ({', '.join(_fmt_fecha(f) for f in fechas)})")
    return " · ".join(partes)


def _serie(fechas: list[date], valores: list) -> tuple[list[date], list]:
    pares = [(f, v) for f, v in zip(fechas, valores) if v is not None]
    return [p[0] for p in pares], [p[1] for p in pares]


def _grafico_persona(registros: list[RegistroPDF], desde: date, hasta: date, ancho_cm: float, alto_cm: float) -> BytesIO:
    registros = sorted(registros, key=lambda r: r.fecha)
    fechas = [r.fecha for r in registros]
    pa = [_parsear_pa(r.presion_arterial) for r in registros]
    sistolica = [p[0] for p in pa]
    diastolica = [p[1] for p in pa]
    fc = [r.frecuencia_cardiaca or None for r in registros]
    spo2 = [r.oxigenacion_sangre or None for r in registros]

    fig = Figure(figsize=(ancho_cm / 2.54, alto_cm / 2.54), dpi=150)
    FigureCanvasAgg(fig)
    axes = fig.subplots(3, 1, sharex=True)

    paneles = [
        ("Presión arterial (mmHg)", [("Sistólica", sistolica, NARANJA, "-", 7), ("Diastólica", diastolica, AMARILLO, "--", -11)]),
        ("Frecuencia cardíaca (lpm)", [("FC", fc, ROJO, "-", 7)]),
        ("SpO2 (%)", [("SpO2", spo2, CELESTE, "-", 7)]),
    ]
    fechas_con_dato = sorted({f for f, *vals in zip(fechas, sistolica, diastolica, fc, spo2) if any(v for v in vals)})
    for ax, (titulo, series) in zip(axes, paneles):
        hay_datos = False
        for etiqueta, valores, color, estilo, desplazamiento in series:
            xs, ys = _serie(fechas, valores)
            if not xs:
                continue
            hay_datos = True
            ax.plot(xs, ys, estilo, color=color, linewidth=1.6, marker="o", markersize=4, label=etiqueta)
            for x, y in zip(xs, ys):
                ax.annotate(f"{y:g}", (x, y), textcoords="offset points", xytext=(0, desplazamiento),
                            ha="center", fontsize=7, color=color)
        ax.set_title(titulo, fontsize=9, color="#222222", loc="left", pad=4)
        ax.tick_params(labelsize=7.5, length=3, colors=GRIS)
        ax.grid(True, color="#e5e5e5", linewidth=0.6)
        for lado in ("top", "right"):
            ax.spines[lado].set_visible(False)
        for lado in ("left", "bottom"):
            ax.spines[lado].set_color("#bbbbbb")
        if hay_datos:
            ax.margins(y=0.3)
            ax.yaxis.set_major_locator(MaxNLocator(nbins=6, integer=True))
            if len(series) > 1:
                ax.legend(fontsize=7, frameon=False, loc="upper left", bbox_to_anchor=(1.0, 1.0), handlelength=1.8)
        else:
            ax.set_yticks([])
            ax.text(0.5, 0.5, "sin datos en el período", ha="center", va="center", fontsize=8, color="#999999",
                    transform=ax.transAxes)

    # Eje de fechas: el período elegido, con una marca en cada día que hubo control.
    ax = axes[-1]
    ax.set_xlim(date2num(desde - timedelta(days=1)), date2num(hasta + timedelta(days=1)))
    ax.set_xticks([date2num(f) for f in fechas_con_dato])
    ax.xaxis.set_major_formatter(DateFormatter("%d/%m/%y"))
    if len(fechas_con_dato) > 8:
        for etiqueta in ax.get_xticklabels():
            etiqueta.set_rotation(45)
            etiqueta.set_horizontalalignment("right")

    fig.tight_layout(pad=0.5, h_pad=0.8)
    buffer = BytesIO()
    fig.savefig(buffer, format="png")
    buffer.seek(0)
    return buffer


def generar_pdf(personas: list[PersonaPDF], desde: date, hasta: date, ahora: datetime | None = None) -> bytes:
    """Una página apaisada por persona. Solo se usan los registros y kits dentro de [desde, hasta]."""
    ahora = ahora or datetime.now()
    hoy = ahora.date()
    periodo = f"{_fmt_fecha(desde)} al {_fmt_fecha(hasta)}"

    estilos = getSampleStyleSheet()
    nombre_st = ParagraphStyle("nombre", parent=estilos["Normal"], fontName="Helvetica-Bold", fontSize=16, leading=19)
    periodo_st = ParagraphStyle("periodo", parent=estilos["Normal"], fontSize=10, leading=12, alignment=2,
                                textColor=colors.HexColor(GRIS))
    detalle_st = ParagraphStyle("detalle", parent=estilos["Normal"], fontSize=10, leading=13,
                                textColor=colors.HexColor("#333333"))
    vacio_st = ParagraphStyle("vacio", parent=detalle_st, fontSize=12, textColor=colors.HexColor("#999999"),
                              fontName="Helvetica-Oblique")

    buffer = BytesIO()
    margen = 1.2 * cm
    doc = SimpleDocTemplate(
        buffer, pagesize=PAGINA, leftMargin=margen, rightMargin=margen, topMargin=1.0 * cm, bottomMargin=1.2 * cm,
        title="SISVAP - Signos vitales", author="Cruz Roja San Rafael",
    )
    ancho = doc.width

    historia = []
    personas = sorted(personas, key=lambda p: (p.apellido.casefold(), p.nombre.casefold()))
    for i, persona in enumerate(personas):
        registros = [r for r in persona.registros if desde <= r.fecha <= hasta]
        kits = [k for k in persona.kits if desde <= k.fecha_entrega <= hasta]
        edad = calcular_edad(persona.fecha_nacimiento, hoy)
        edad_txt = f"{edad} años" if edad is not None else "edad s/d"
        nombre = f"{persona.apellido.upper()}, {persona.nombre}" if persona.apellido else persona.nombre

        encabezado = Table(
            [[Paragraph(f"{nombre} &nbsp;·&nbsp; {edad_txt}", nombre_st), Paragraph(f"Período: {periodo}", periodo_st)]],
            colWidths=[ancho * 0.65, ancho * 0.35],
        )
        encabezado.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor(ROJO)),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        historia += [
            encabezado,
            Spacer(1, 5),
            Paragraph(f"<b>Kits en el período:</b> {resumen_kits(kits)}", detalle_st),
            Paragraph(f"<b>Controles en el período:</b> {len(registros)}", detalle_st),
            Spacer(1, 6),
        ]
        if registros:
            alto_cm = 15.2
            png = _grafico_persona(registros, desde, hasta, ancho / cm, alto_cm)
            historia.append(Image(png, width=ancho, height=alto_cm * cm))
        else:
            historia.append(Spacer(1, 2 * cm))
            historia.append(Paragraph("Sin controles de signos vitales en el período.", vacio_st))
        if i < len(personas) - 1:
            historia.append(PageBreak())

    if not personas:
        historia.append(Paragraph("No se eligió ninguna persona.", vacio_st))

    def pie(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#888888"))
        canvas.drawString(
            doc_.leftMargin, 0.6 * cm,
            f"SISVAP · Cruz Roja San Rafael · Confidencial · Generado el {ahora.strftime('%d/%m/%Y %H:%M')}",
        )
        canvas.drawRightString(PAGINA[0] - doc_.rightMargin, 0.6 * cm, f"Página {doc_.page}")
        canvas.restoreState()

    doc.build(historia, onFirstPage=pie, onLaterPages=pie)
    return buffer.getvalue()
