from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import math

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash

from app.auth import hash_password
from app.models import (
    AppSettings,
    Appointment,
    AppointmentSlot,
    AppointmentStatus,
    Barber,
    BarberService,
    ExceptionType,
    ScheduleException,
    ScheduleWeekly,
    Service,
    User,
    UserRole,
)


@dataclass(frozen=True)
class TimeRange:
    start: time
    end: time


def get_or_create_settings(db: Session) -> AppSettings:
    s = db.get(AppSettings, 1)
    if s:
        if s.slot_minutes != 60:
            s.slot_minutes = 60
            s.updated_at = datetime.utcnow()
            db.add(s)
            db.commit()
            db.refresh(s)
        return s
    s = AppSettings(id=1, slot_minutes=60, booking_horizon_days=30, min_notice_minutes=60, currency="COP")
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def update_settings_with_lock(
    db: Session,
    *,
    slot_minutes: int | None,
    booking_horizon_days: int | None,
    min_notice_minutes: int | None,
    currency: str | None,
) -> AppSettings:
    s = get_or_create_settings(db)
    now = datetime.utcnow()

    if slot_minutes is not None and slot_minutes != s.slot_minutes:
        raise ValueError("slot_minutes está fijo en 60 minutos")

    if booking_horizon_days is not None:
        s.booking_horizon_days = booking_horizon_days
    if min_notice_minutes is not None:
        s.min_notice_minutes = min_notice_minutes
    if currency is not None:
        s.currency = currency

    s.updated_at = datetime.utcnow()
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def seed_admin_if_needed(db: Session, *, email: str, password_hash: str) -> None:
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        needs_update = False
        if not existing.password_hash:
            needs_update = True
        else:
            try:
                check_password_hash(existing.password_hash, "probe")
            except ValueError:
                needs_update = True

        if existing.role != UserRole.ADMIN:
            existing.role = UserRole.ADMIN
            needs_update = True
        if not existing.is_active:
            existing.is_active = True
            needs_update = True
        if needs_update:
            existing.password_hash = password_hash
            db.add(existing)
            db.commit()
        return
    user = User(email=email, password_hash=password_hash, role=UserRole.ADMIN, full_name="Admin", is_active=True)
    db.add(user)
    db.commit()


def seed_demo_if_needed(db: Session) -> None:
    has_service = db.execute(select(Service.id)).first()
    if not has_service:
        service = Service(name="Corte", duration_min=30, price_cents=5000, requires_payment=False, is_active=True)
        db.add(service)
        db.flush()
    else:
        service = db.execute(select(Service).limit(1)).scalar_one()

    has_barber = db.execute(select(Barber.id)).first()
    if not has_barber:
        barber_user = User(
            email="barber1@barbershop.local",
            password_hash=hash_password("barber12345"),
            role=UserRole.BARBER,
            full_name="Barbero 1",
            is_active=True,
        )
        db.add(barber_user)
        db.flush()
        barber = Barber(user_id=barber_user.id, display_name="Barbero 1", timezone="UTC", is_bookable=True)
        db.add(barber)
        db.flush()

    db.commit()

    barbers = db.execute(select(Barber)).scalars().all()
    start = time(9, 0, 0)
    end = time(18, 0, 0)
    for b in barbers:
        has_link = db.get(BarberService, {"barber_id": b.id, "service_id": service.id})
        if not has_link:
            db.add(BarberService(barber_id=b.id, service_id=service.id))

        has_weekly = db.execute(select(ScheduleWeekly.id).where(ScheduleWeekly.barber_id == b.id).limit(1)).first()
        if not has_weekly:
            for weekday in [1, 2, 3, 4, 5, 6]:
                db.add(ScheduleWeekly(barber_id=b.id, weekday=weekday, start_time=start, end_time=end, is_active=True))

    db.commit()


def _time_from_dt(dt: datetime) -> time:
    return time(hour=dt.hour, minute=dt.minute, second=dt.second)


def _combine(d: date, t: time) -> datetime:
    return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)


def _generate_slots_for_range(d: date, r: TimeRange, slot_minutes: int) -> list[datetime]:
    start_dt = _combine(d, r.start)
    end_dt = _combine(d, r.end)
    slots: list[datetime] = []
    cur = start_dt
    delta = timedelta(minutes=slot_minutes)
    while cur + delta <= end_dt:
        slots.append(cur)
        cur += delta
    return slots


def _merge_ranges(ranges: list[TimeRange]) -> list[TimeRange]:
    if not ranges:
        return []
    items = sorted(ranges, key=lambda r: (r.start, r.end))
    merged: list[TimeRange] = [items[0]]
    for r in items[1:]:
        last = merged[-1]
        if r.start <= last.end:
            merged[-1] = TimeRange(last.start, max(last.end, r.end))
        else:
            merged.append(r)
    return merged


def _subtract_blocks(opens: list[TimeRange], blocks: list[TimeRange]) -> list[TimeRange]:
    if not opens:
        return []
    if not blocks:
        return opens

    result = opens
    for b in blocks:
        next_result: list[TimeRange] = []
        for o in result:
            if b.end <= o.start or b.start >= o.end:
                next_result.append(o)
                continue
            if b.start > o.start:
                next_result.append(TimeRange(o.start, b.start))
            if b.end < o.end:
                next_result.append(TimeRange(b.end, o.end))
        result = next_result
    return result


def get_available_start_times(db: Session, *, barber_id: str, service_id: str, day: date) -> tuple[int, list[datetime]]:
    s = get_or_create_settings(db)
    slot_minutes = s.slot_minutes

    service = db.get(Service, service_id)
    if not service or not service.is_active:
        raise ValueError("Servicio no encontrado")
    if not isinstance(service.duration_min, int) or service.duration_min <= 0:
        raise ValueError("Duración del servicio inválida")

    barber = db.get(Barber, barber_id)
    if not barber or not barber.is_bookable:
        raise ValueError("Barbero no disponible")

    link_exists = db.get(BarberService, {"barber_id": barber_id, "service_id": service_id})
    if not link_exists:
        raise ValueError("Este barbero no ofrece el servicio seleccionado")

    weekday = (day.weekday() + 1) % 7
    weekly_segments = db.execute(
        select(ScheduleWeekly).where(
            and_(
                ScheduleWeekly.barber_id == barber_id,
                ScheduleWeekly.weekday == weekday,
                ScheduleWeekly.is_active == True,
            )
        )
    ).scalars().all()

    open_ranges = [TimeRange(w.start_time, w.end_time) for w in weekly_segments]

    exceptions = db.execute(
        select(ScheduleException).where(and_(ScheduleException.barber_id == barber_id, ScheduleException.date == day))
    ).scalars().all()

    open_additions: list[TimeRange] = []
    blocks: list[TimeRange] = []
    for ex in exceptions:
        if ex.type == ExceptionType.OPEN:
            if ex.start_time and ex.end_time:
                open_additions.append(TimeRange(ex.start_time, ex.end_time))
        else:
            if ex.start_time and ex.end_time:
                blocks.append(TimeRange(ex.start_time, ex.end_time))
            else:
                blocks.append(TimeRange(time(0, 0, 0), time(23, 59, 59)))

    open_ranges = _merge_ranges(open_ranges + open_additions)
    open_ranges = _subtract_blocks(open_ranges, blocks)

    free_slots: list[datetime] = []
    for r in open_ranges:
        free_slots.extend(_generate_slots_for_range(day, r, slot_minutes))

    if not free_slots:
        return slot_minutes, []

    start_day = _combine(day, time(0, 0, 0))
    end_day = start_day + timedelta(days=1)

    booked = db.execute(
        select(AppointmentSlot.slot_at).where(
            and_(
                AppointmentSlot.barber_id == barber_id,
                AppointmentSlot.slot_at >= start_day,
                AppointmentSlot.slot_at < end_day,
            )
        )
    ).scalars().all()
    booked_set = set(booked)

    required_slots = max(1, math.ceil(service.duration_min / slot_minutes))
    delta = timedelta(minutes=slot_minutes)
    available: list[datetime] = []
    free_set = set(free_slots)

    for start in sorted(free_set):
        ok = True
        for i in range(required_slots):
            candidate = start + delta * i
            if candidate not in free_set or candidate in booked_set:
                ok = False
                break
        if ok:
            available.append(start)

    return slot_minutes, available


def book_appointment_by_slots(
    db: Session,
    *,
    barber_id: str,
    service_id: str,
    start_at: datetime,
    client_user: User,
) -> Appointment:
    s = get_or_create_settings(db)
    slot_minutes = s.slot_minutes
    service = db.get(Service, service_id)
    if not service or not service.is_active:
        raise ValueError("Servicio no encontrado")
    if not isinstance(service.duration_min, int) or service.duration_min <= 0:
        raise ValueError("Duración del servicio inválida")

    required_slots = max(1, math.ceil(service.duration_min / slot_minutes))
    end_at = start_at + timedelta(minutes=service.duration_min)

    appointment = Appointment(
        client_user_id=client_user.id,
        barber_id=barber_id,
        service_id=service_id,
        start_at=start_at,
        end_at=end_at,
        status=AppointmentStatus.PENDING,
        price_cents=service.price_cents,
    )

    delta = timedelta(minutes=slot_minutes)
    slots = [AppointmentSlot(barber_id=barber_id, slot_at=start_at + delta * i) for i in range(required_slots)]
    appointment.slots = slots

    try:
        db.add(appointment)
        db.commit()
        db.refresh(appointment)
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Horario no disponible (conflicto de slots)") from exc

    return appointment
