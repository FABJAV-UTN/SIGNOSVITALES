from datetime import date, datetime
from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Time
from sqlalchemy.orm import relationship

from .database import Base

class Persona(Base):
    __tablename__ = "personas"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(120), nullable=False)
    apellido = Column(String(120), nullable=False)
    dni = Column(String(8), unique=True, nullable=False, index=True)
    fecha_nacimiento = Column(Date, nullable=True)
    genero = Column(String(40), nullable=True)
    situacion_de_calle = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    registros = relationship("RegistroSignosVitales", back_populates="persona", cascade="all, delete-orphan")
    kits = relationship("Kit", back_populates="persona", cascade="all, delete-orphan")

class Operativo(Base):
    __tablename__ = "operativos"

    id = Column(Integer, primary_key=True, index=True)
    lugar = Column(String(180), nullable=False, default="Museo Ferroviario")
    dia_semana = Column(String(50), nullable=False, default="Jueves")
    hora = Column(Time, nullable=False)
    activo = Column(Boolean, nullable=False, default=True)

    registros = relationship("RegistroSignosVitales", back_populates="operativo")

class RegistroSignosVitales(Base):
    __tablename__ = "registro_signos_vitales"

    id = Column(Integer, primary_key=True, index=True)
    persona_id = Column(Integer, ForeignKey("personas.id"), nullable=False)
    operativo_id = Column(Integer, ForeignKey("operativos.id"), nullable=False)
    fecha = Column(Date, nullable=False, default=date.today)
    hora = Column(Time, nullable=False, default=lambda: datetime.now().time().replace(microsecond=0))
    presion_arterial = Column(String(16), nullable=False)
    frecuencia_cardiaca = Column(Integer, nullable=False)
    oxigenacion_sangre = Column(Float, nullable=False)

    persona = relationship("Persona", back_populates="registros")
    operativo = relationship("Operativo", back_populates="registros")

class Kit(Base):
    __tablename__ = "kits"

    id = Column(Integer, primary_key=True, index=True)
    persona_id = Column(Integer, ForeignKey("personas.id"), nullable=False)
    tipo = Column(String(16), nullable=False)
    fecha_entrega = Column(Date, nullable=False, default=date.today)

    persona = relationship("Persona", back_populates="kits")
