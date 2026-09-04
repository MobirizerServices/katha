"""approvals table; admin_kv.value → Text

The dual-approval queue used to live in process memory (lost on restart,
invisible to the other gunicorn workers). admin_kv.value was String(1024) but
holds whole draft series and experiments — SQLite ignored the length, Postgres
would have raised on the first long synopsis.

Revision ID: 0002_approvals_kv_text
Revises: 0001_baseline
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_approvals_kv_text"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approval",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("requested_by", sa.String(), nullable=False),
        sa.Column("approved_by", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("coins", sa.Integer(), nullable=False),
        sa.Column("reason_code", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("decided_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_approval_status"), "approval", ["status"], unique=False)
    with op.batch_alter_table("admin_kv") as b:      # batch: SQLite needs a table rebuild
        b.alter_column("value", existing_type=sa.String(length=1024), type_=sa.Text(),
                       existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("admin_kv") as b:
        b.alter_column("value", existing_type=sa.Text(), type_=sa.String(length=1024),
                       existing_nullable=False)
    op.drop_index(op.f("ix_approval_status"), table_name="approval")
    op.drop_table("approval")
