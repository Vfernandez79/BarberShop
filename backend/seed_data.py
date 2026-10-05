from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta
import os
from pathlib import Path
import random
import sys

from dotenv import load_dotenv
from sqlalchemy import delete, func, select

from app.auth import hash_password
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import (
    Appointment,
    AppointmentSlot,
    AppointmentStatus,
    Barber,
    BarberService,
    ScheduleException,
    ScheduleWeekly,
    Service,
    User,
    UserRole,
)
from app.services import get_or_create_settings, seed_admin_if_needed


def _ensure_schema() -> None:
    if settings.db_auto_create:
        Base.metadata.create_all(bind=engine)


def _reset_data(db) -> None:
    admin_email = settings.seed_admin_email

    db.execute(delete(AppointmentSlot))
    db.execute(delete(Appointment))
    db.execute(delete(ScheduleException))
    db.execute(delete(ScheduleWeekly))
    db.execute(delete(BarberService))
    db.execute(delete(Barber))
    db.execute(delete(Service))
    db.execute(delete(User).where(User.email != admin_email))
    db.commit()


def _seed_services(db) -> list[Service]:
    existing = db.execute(select(Service).order_by(Service.name)).scalars().all()
    if existing:
        return existing
    items = [
        Service(name="Corte", duration_min=30, price_cents=5000, requires_payment=False, is_active=True),
        Service(name="Barba", duration_min=20, price_cents=4000, requires_payment=False, is_active=True),
        Service(name="Corte + Barba", duration_min=45, price_cents=8000, requires_payment=False, is_active=True),
        Service(name="Lavado", duration_min=15, price_cents=2000, requires_payment=False, is_active=True),
        Service(name="Premium", duration_min=60, price_cents=12000, requires_payment=True, is_active=True),
    ]
    db.add_all(items)
    db.commit()
    return db.execute(select(Service).order_by(Service.name)).scalars().all()


def _seed_barbers(db, *, count: int, timezone: str) -> list[Barber]:
    existing = db.execute(select(Barber).order_by(Barber.display_name)).scalars().all()
    if len(existing) >= count:
        return existing[:count]
    created: list[Barber] = []
    for i in range(len(existing) + 1, count + 1):
        email = f"barber{i}@barbershop.local"
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if not user:
            user = User(
                email=email,
                password_hash=hash_password("barber12345"),
                role=UserRole.BARBER,
                full_name=f"Barbero {i}",
                is_active=True,
            )
            db.add(user)
            db.flush()
        barber = Barber(user_id=user.id, display_name=f"Barbero {i}", timezone=timezone, is_bookable=True)
        db.add(barber)
        db.flush()

        start = time(9, 0, 0)
        end = time(18, 0, 0)
        for weekday in [1, 2, 3, 4, 5, 6]:
            db.add(ScheduleWeekly(barber_id=barber.id, weekday=weekday, start_time=start, end_time=end, is_active=True))

        created.append(barber)
    db.commit()
    return existing + created


def _ensure_barber_services(db, *, barber_id: str, service_ids: list[str]) -> None:
    for sid in service_ids:
        existing = db.get(BarberService, {"barber_id": barber_id, "service_id": sid})
        if not existing:
            db.add(BarberService(barber_id=barber_id, service_id=sid))
    db.commit()


def _seed_appointments(db, *, barbers: list[Barber], services: list[Service], days: int, per_day_per_barber: int) -> int:
    if per_day_per_barber <= 0:
        return 0

    created = 0
    now = datetime.utcnow()
    for barber in barbers:
        for d in range(days):
            day = (now + timedelta(days=d)).date()
            weekday = (day.weekday() + 1) % 7
            weekly = db.execute(
                select(ScheduleWeekly).where(
                    ScheduleWeekly.barber_id == barber.id,
                    ScheduleWeekly.weekday == weekday,
                    ScheduleWeekly.is_active == True,
                )
            ).scalars().first()
            if not weekly:
                continue
            start_dt = datetime(day.year, day.month, day.day, weekly.start_time.hour, weekly.start_time.minute)
            end_dt = datetime(day.year, day.month, day.day, weekly.end_time.hour, weekly.end_time.minute)

            for _ in range(per_day_per_barber):
                service = random.choice([s for s in services if s.is_active])
                latest_start = end_dt - timedelta(minutes=service.duration_min)
                if latest_start <= start_dt:
                    continue
                start_at = start_dt + timedelta(minutes=random.randint(0, int((latest_start - start_dt).total_seconds() // 60)))
                start_at = start_at.replace(minute=(start_at.minute // 15) * 15, second=0, microsecond=0)
                end_at = start_at + timedelta(minutes=service.duration_min)

                client_email = f"client{random.randint(1, 2000)}@example.com"
                client = db.execute(select(User).where(User.email == client_email)).scalar_one_or_none()
                if not client:
                    client = User(email=client_email, password_hash=None, role=UserRole.CLIENT, full_name="Cliente", is_active=True)
                    db.add(client)
                    db.flush()

                appointment = Appointment(
                    client_user_id=client.id,
                    barber_id=barber.id,
                    service_id=service.id,
                    start_at=start_at,
                    end_at=end_at,
                    status=AppointmentStatus.CONFIRMED,
                    price_cents=service.price_cents,
                )
                db.add(appointment)
                db.flush()

                slot_minutes = get_or_create_settings(db).slot_minutes
                slots = []
                cur = start_at
                while cur < end_at:
                    slots.append(AppointmentSlot(appointment_id=appointment.id, barber_id=barber.id, slot_at=cur))
                    cur += timedelta(minutes=slot_minutes)
                appointment.slots = slots
                db.add(appointment)
                created += 1

    db.commit()
    return created


def seed(*, reset: bool, barbers: int, days: int, per_day_per_barber: int, timezone: str) -> dict[str, int]:
    _ensure_schema()
    db = SessionLocal()
    try:
        seed_admin_if_needed(db, email=settings.seed_admin_email, password_hash=hash_password(settings.seed_admin_password))
        get_or_create_settings(db)

        if reset:
            _reset_data(db)

        services = _seed_services(db)
        barbers_list = _seed_barbers(db, count=barbers, timezone=timezone)
        for b in barbers_list:
            _ensure_barber_services(db, barber_id=b.id, service_ids=[s.id for s in services])

        appointments_created = _seed_appointments(
            db, barbers=barbers_list, services=services, days=days, per_day_per_barber=per_day_per_barber
        )

        services_count = db.execute(select(func.count()).select_from(Service)).scalar_one()
        barbers_count = db.execute(select(func.count()).select_from(Barber)).scalar_one()
        appointments_count = db.execute(select(func.count()).select_from(Appointment)).scalar_one()

        return {
            "services": int(services_count),
            "barbers": int(barbers_count),
            "appointments": int(appointments_count),
            "appointments_created": int(appointments_created),
        }
    finally:
        db.close()


def _safe_db_label() -> str:
    url = settings.database_url
    if url.startswith("sqlite:///"):
        return url
    server = (os.getenv("AZURE_SQL_SERVER") or "").strip()
    database = (os.getenv("AZURE_SQL_DATABASE") or "").strip()
    if server and database:
        return f"mssql+pyodbc (server={server}, database={database})"
    if url.startswith("mssql+pyodbc"):
        return "mssql+pyodbc"
    return "unknown"


def main(argv: list[str]) -> int:
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    load_dotenv(override=False)

    parser = argparse.ArgumentParser(prog="seed_data.py")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--barbers", type=int, default=3)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--per-day-per-barber", type=int, default=2)
    parser.add_argument("--timezone", type=str, default="UTC")
    args = parser.parse_args(argv[1:])

    stats = seed(
        reset=bool(args.reset),
        barbers=max(1, int(args.barbers)),
        days=max(1, int(args.days)),
        per_day_per_barber=max(0, int(args.per_day_per_barber)),
        timezone=str(args.timezone),
    )

    print("Seed completado")
    print(f"- DB: {_safe_db_label()}")
    print(f"- Servicios: {stats['services']}")
    print(f"- Barberos: {stats['barbers']}")
    print(f"- Citas: {stats['appointments']}")
    print(f"- Citas creadas en esta corrida: {stats['appointments_created']}")
    print(f"- Admin: {settings.seed_admin_email} / {settings.seed_admin_password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

