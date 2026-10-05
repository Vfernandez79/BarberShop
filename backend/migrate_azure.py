from __future__ import annotations

import argparse
import sys

from app.config import settings
from app.db import Base, engine
import app.models
from sqlalchemy import text
from sqlalchemy.engine import Engine


def upgrade() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_compat(engine)


def wipe_appointments() -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM appointment_slots"))
        conn.execute(text("DELETE FROM appointments"))


def _has_column(conn, *, table: str, column: str) -> bool:
    sql = (
        "SELECT 1 FROM sys.columns c "
        "JOIN sys.tables t ON c.object_id=t.object_id "
        "WHERE t.name=:table AND c.name=:column"
    )
    return conn.execute(text(sql), {"table": table, "column": column}).first() is not None


def _has_table(conn, *, table: str) -> bool:
    sql = "SELECT 1 FROM sys.tables WHERE name=:table"
    return conn.execute(text(sql), {"table": table}).first() is not None


def _ensure_compat(db_engine: Engine) -> None:
    with db_engine.begin() as conn:
        if not _has_table(conn, table="payment_methods"):
            conn.execute(
                text(
                    "CREATE TABLE payment_methods ("
                    "id int IDENTITY(1,1) NOT NULL PRIMARY KEY, "
                    "name varchar(80) NOT NULL UNIQUE, "
                    "iva_percent decimal(5,2) NOT NULL CONSTRAINT DF_payment_methods_iva DEFAULT (19.00)"
                    ")"
                )
            )
        conn.execute(
            text(
                "IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE name='Efectivo') "
                "INSERT INTO payment_methods (name, iva_percent) VALUES ('Efectivo', 19.00)"
            )
        )
        conn.execute(
            text(
                "IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE name='Transferencia') "
                "INSERT INTO payment_methods (name, iva_percent) VALUES ('Transferencia', 19.00)"
            )
        )
        conn.execute(
            text(
                "IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE name='RedCompra') "
                "INSERT INTO payment_methods (name, iva_percent) VALUES ('RedCompra', 19.00)"
            )
        )

        if not _has_column(conn, table="appointments", column="payment_method_id"):
            conn.execute(
                text(
                    "ALTER TABLE appointments "
                    "ADD payment_method_id int NOT NULL "
                    "CONSTRAINT DF_appointments_payment_method_id DEFAULT (1)"
                )
            )
        conn.execute(text("UPDATE appointments SET payment_method_id=1 WHERE payment_method_id IS NULL"))

        if not _has_column(conn, table="barbers", column="created_at"):
            conn.execute(
                text(
                    "ALTER TABLE barbers "
                    "ADD created_at datetime2 NOT NULL "
                    "CONSTRAINT DF_barbers_created_at DEFAULT (SYSUTCDATETIME())"
                )
            )
        if not _has_column(conn, table="barbers", column="photo_url"):
            conn.execute(text("ALTER TABLE barbers ADD photo_url varchar(500) NULL"))
        if not _has_column(conn, table="barbers", column="photo_blob"):
            conn.execute(text("ALTER TABLE barbers ADD photo_blob varbinary(max) NULL"))
        if not _has_column(conn, table="barbers", column="photo_mime"):
            conn.execute(text("ALTER TABLE barbers ADD photo_mime varchar(100) NULL"))
        if not _has_column(conn, table="app_settings", column="slot_minutes"):
            conn.execute(
                text(
                    "ALTER TABLE app_settings "
                    "ADD slot_minutes int NOT NULL "
                    "CONSTRAINT DF_app_settings_slot_minutes DEFAULT (60)"
                )
            )
        if not _has_column(conn, table="app_settings", column="booking_horizon_days"):
            conn.execute(
                text(
                    "ALTER TABLE app_settings "
                    "ADD booking_horizon_days int NOT NULL "
                    "CONSTRAINT DF_app_settings_booking_horizon_days DEFAULT (30)"
                )
            )
        if not _has_column(conn, table="app_settings", column="min_notice_minutes"):
            conn.execute(
                text(
                    "ALTER TABLE app_settings "
                    "ADD min_notice_minutes int NOT NULL "
                    "CONSTRAINT DF_app_settings_min_notice_minutes DEFAULT (60)"
                )
            )
        if not _has_column(conn, table="app_settings", column="currency"):
            conn.execute(
                text(
                    "ALTER TABLE app_settings "
                    "ADD currency varchar(10) NOT NULL "
                    "CONSTRAINT DF_app_settings_currency DEFAULT ('COP')"
                )
            )
        if not _has_column(conn, table="app_settings", column="updated_at"):
            conn.execute(
                text(
                    "ALTER TABLE app_settings "
                    "ADD updated_at datetime2 NOT NULL "
                    "CONSTRAINT DF_app_settings_updated_at DEFAULT (SYSUTCDATETIME())"
                )
            )
        settings_exists = conn.execute(text("SELECT 1 FROM app_settings WHERE id=1")).first() is not None
        if not settings_exists:
            conn.execute(
                text(
                    "INSERT INTO app_settings (id, slot_minutes, booking_horizon_days, min_notice_minutes, currency, updated_at) "
                    "VALUES (1, 60, 30, 60, 'COP', SYSUTCDATETIME())"
                )
            )
        else:
            conn.execute(text("UPDATE app_settings SET slot_minutes=60 WHERE id=1"))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="migrate_azure.py")
    parser.add_argument("command", choices=["upgrade", "wipe_appointments"])
    args = parser.parse_args(argv[1:])

    if not settings.database_url.startswith("mssql+pyodbc"):
        raise SystemExit("DATABASE_URL/AZURE_SQL_* no apunta a mssql+pyodbc")

    if args.command == "upgrade":
        upgrade()
        print("Migración completada (create_all)")
        return 0
    if args.command == "wipe_appointments":
        wipe_appointments()
        print("Appointments eliminadas")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
