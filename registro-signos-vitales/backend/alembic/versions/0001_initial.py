"""Initial migration

Revision ID: 0001_initial
Revises: 
Create Date: 2026-06-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "personas",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("nombre", sa.String(length=120), nullable=False),
        sa.Column("apellido", sa.String(length=120), nullable=False),
        sa.Column("dni", sa.String(length=8), nullable=False, unique=True),
        sa.Column("fecha_nacimiento", sa.Date(), nullable=True),
        sa.Column("genero", sa.String(length=40), nullable=True),
        sa.Column("situacion_de_calle", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "operativos",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("lugar", sa.String(length=180), nullable=False),
        sa.Column("dia_semana", sa.String(length=50), nullable=False),
        sa.Column("hora", sa.Time(), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )
    op.create_table(
        "registro_signos_vitales",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("personas.id"), nullable=False),
        sa.Column("operativo_id", sa.Integer(), sa.ForeignKey("operativos.id"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("hora", sa.Time(), nullable=False),
        sa.Column("presion_arterial", sa.String(length=16), nullable=False),
        sa.Column("frecuencia_cardiaca", sa.Integer(), nullable=False),
        sa.Column("oxigenacion_sangre", sa.Float(), nullable=False),
    )
    op.create_table(
        "kits",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("personas.id"), nullable=False),
        sa.Column("tipo", sa.String(length=16), nullable=False),
        sa.Column("fecha_entrega", sa.Date(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("kits")
    op.drop_table("registro_signos_vitales")
    op.drop_table("operativos")
    op.drop_table("personas")
