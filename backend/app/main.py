from __future__ import annotations

from datetime import datetime, time, timedelta
from io import BytesIO
import os
import secrets

from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from sqlalchemy import and_, func, select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import check_password_hash

from app.auth import create_access_token, create_booking_token, hash_password, require_role, verify_booking_token, verify_password
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.firebase_session import verify_firebase_id_token
from app.models import (
    AppointmentStatus,
    Appointment,
    Barber,
    BarberService,
    EmailVerification,
    ExceptionType,
    PaymentMethod,
    ScheduleException,
    ScheduleWeekly,
    Service,
    User,
    UserRole,
)
from app.services import (
    book_appointment_by_slots,
    get_available_start_times,
    get_or_create_settings,
    seed_admin_if_needed,
    seed_demo_if_needed,
    update_settings_with_lock,
)
from app.notifications import BookingEmail, SimpleEmail, build_appointment_ics, send_booking_email_async, send_simple_email_async

_STARTED_AT = datetime.utcnow().isoformat()

_FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173"
).rstrip("/")

def create_app() -> Flask:
    app = Flask(__name__)
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    CORS(app, origins=origins)

    allow_any = "*" in origins
    origins_set = set(origins)

    @app.after_request
    def _cors_headers(resp):
        origin = request.headers.get("Origin")
        if allow_any:
            resp.headers.setdefault("Access-Control-Allow-Origin", "*")
        elif origin and origin in origins_set:
            resp.headers.setdefault("Access-Control-Allow-Origin", origin)
        else:
            resp.headers.setdefault("Access-Control-Allow-Origin", "*")
        resp.headers.setdefault("Vary", "Origin")
        resp.headers.setdefault("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Booking-Token")
        resp.headers.setdefault("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        return resp

    if settings.db_auto_create:
        Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        try:
            get_or_create_settings(db)
            seed_admin_if_needed(
                db, email=settings.seed_admin_email, password_hash=hash_password(settings.seed_admin_password)
            )
            seed_demo_if_needed(db)
        except SQLAlchemyError:
            db.rollback()
    finally:
        db.close()

    @app.errorhandler(SQLAlchemyError)
    def _db_error(err):
        return (
            jsonify(
                {
                    "detail": "Error de base de datos. Verifica conexión a Azure SQL y que el esquema exista (ejecuta backend/migrate_azure.py upgrade).",
                    "type": type(err).__name__,
                }
            ),
            503,
        )

    @app.before_request
    def _open_db():
        g.db = SessionLocal()

    @app.teardown_request
    def _close_db(_exc):
        db = getattr(g, "db", None)
        if db:
            db.close()

    @app.get("/health")
    def health():
        s = get_or_create_settings(g.db)
        url = settings.database_url
        dialect = "sqlite" if url.startswith("sqlite") else ("mssql+pyodbc" if url.startswith("mssql+pyodbc") else "unknown")
        azure_database = (os.getenv("AZURE_SQL_DATABASE") or "").strip() or None if dialect == "mssql+pyodbc" else None
        return jsonify(
            {
                "status": "ok",
                "slot_minutes": s.slot_minutes,
                "slot_policy": "fixed-60",
                "dialect": dialect,
                "azure_database": azure_database,
                "api_prefix": settings.api_prefix,
                "started_at": _STARTED_AT,
                "smtp_enabled": settings.smtp_enabled,
                "booking_dev_mode": bool((not settings.smtp_enabled) and settings.booking_dev_code),
            }
        )

    @app.get("/health/dbinfo")
    def health_dbinfo():
        url = settings.database_url
        if url.startswith("sqlite"):
            return jsonify(
                {
                    "dialect": "sqlite",
                    "db_auto_create": settings.db_auto_create,
                    "api_prefix": settings.api_prefix,
                    "started_at": _STARTED_AT,
                    "smtp_enabled": settings.smtp_enabled,
                    "booking_dev_mode": bool((not settings.smtp_enabled) and settings.booking_dev_code),
                }
            )
        if url.startswith("mssql+pyodbc"):
            return jsonify(
                {
                    "dialect": "mssql+pyodbc",
                    "azure_server": (os.getenv("AZURE_SQL_SERVER") or "").strip() or None,
                    "azure_database": (os.getenv("AZURE_SQL_DATABASE") or "").strip() or None,
                    "db_auto_create": settings.db_auto_create,
                    "api_prefix": settings.api_prefix,
                    "started_at": _STARTED_AT,
                    "smtp_enabled": settings.smtp_enabled,
                    "booking_dev_mode": bool((not settings.smtp_enabled) and settings.booking_dev_code),
                }
            )
        return jsonify(
            {
                "dialect": "unknown",
                "db_auto_create": settings.db_auto_create,
                "api_prefix": settings.api_prefix,
                "started_at": _STARTED_AT,
                "smtp_enabled": settings.smtp_enabled,
                "booking_dev_mode": bool((not settings.smtp_enabled) and settings.booking_dev_code),
            }
        )

    @app.get("/health/db")
    def health_db():
        g.db.execute(select(1)).first()
        return jsonify({"status": "ok"})

    @app.get(f"{settings.api_prefix}/admin/debug/db")
    @require_role(UserRole.ADMIN)
    def debug_db():
        url = settings.database_url
        if url.startswith("sqlite:///"):
            return jsonify(
                {
                    "dialect": "sqlite",
                    "url": url,
                    "pid": os.getpid(),
                    "cwd": os.getcwd(),
                    "started_at": _STARTED_AT,
                    "api_prefix": settings.api_prefix,
                    "db_auto_create": settings.db_auto_create,
                }
            )
        return jsonify(
            {
                "dialect": "mssql+pyodbc" if url.startswith("mssql+pyodbc") else "unknown",
                "azure_server": (os.getenv("AZURE_SQL_SERVER") or "").strip() or None,
                "azure_database": (os.getenv("AZURE_SQL_DATABASE") or "").strip() or None,
                "pid": os.getpid(),
                "cwd": os.getcwd(),
                "started_at": _STARTED_AT,
                "api_prefix": settings.api_prefix,
                "db_auto_create": settings.db_auto_create,
            }
        )

    @app.post(f"{settings.api_prefix}/auth/login")
    def login():
        payload = request.get_json(force=True, silent=True) or {}
        email = payload.get("email")
        password = payload.get("password")
        if not email or not password:
            return jsonify({"detail": "email y password son requeridos"}), 400

        user = g.db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if not user or not user.password_hash or not verify_password(password, user.password_hash):
            return jsonify({"detail": "Credenciales inválidas"}), 401
        if not user.is_active:
            return jsonify({"detail": "Usuario inactivo"}), 403
        token = create_access_token(user_id=user.id, role=user.role.value)
        return jsonify({"access_token": token, "token_type": "bearer"})

    @app.get(f"{settings.api_prefix}/settings")
    def get_settings():
        s = get_or_create_settings(g.db)
        return jsonify(
            {
                "slot_minutes": s.slot_minutes,
                "booking_horizon_days": s.booking_horizon_days,
                "min_notice_minutes": s.min_notice_minutes,
                "currency": s.currency,
            }
        )

    @app.put(f"{settings.api_prefix}/settings")
    @require_role(UserRole.ADMIN)
    def put_settings():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            s = update_settings_with_lock(
                g.db,
                slot_minutes=payload.get("slot_minutes"),
                booking_horizon_days=payload.get("booking_horizon_days"),
                min_notice_minutes=payload.get("min_notice_minutes"),
                currency=payload.get("currency"),
            )
        except ValueError as exc:
            return jsonify({"detail": str(exc)}), 409
        return jsonify(
            {
                "slot_minutes": s.slot_minutes,
                "booking_horizon_days": s.booking_horizon_days,
                "min_notice_minutes": s.min_notice_minutes,
                "currency": s.currency,
            }
        )

    @app.get(f"{settings.api_prefix}/admin/barbers")
    @require_role(UserRole.ADMIN)
    def list_barbers():
        barbers = g.db.execute(select(Barber).order_by(Barber.display_name)).scalars().all()
        return jsonify(
            [
                {
                    "id": b.id,
                    "display_name": b.display_name,
                    "has_photo": bool(b.photo_blob),
                    "timezone": b.timezone,
                    "is_bookable": b.is_bookable,
                }
                for b in barbers
            ]
        )

    @app.post(f"{settings.api_prefix}/admin/barbers")
    @require_role(UserRole.ADMIN)
    def create_barber():
        payload = request.get_json(force=True, silent=True) or {}
        display_name = payload.get("display_name")
        timezone = payload.get("timezone", "UTC")
        email = payload.get("email")
        password = payload.get("password")
        if not display_name or not email:
            return jsonify({"detail": "display_name y email son requeridos"}), 400

        existing = g.db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing:
            return jsonify({"detail": "Email ya existe"}), 400

        password_hash = hash_password(password) if password else None
        user = User(email=email, password_hash=password_hash, role=UserRole.BARBER, full_name=display_name, is_active=True)
        g.db.add(user)
        g.db.flush()

        barber = Barber(user_id=user.id, display_name=display_name, timezone=timezone, is_bookable=True)
        g.db.add(barber)
        g.db.commit()
        g.db.refresh(barber)
        return jsonify(
            {
                "id": barber.id,
                "display_name": barber.display_name,
                "has_photo": bool(barber.photo_blob),
                "timezone": barber.timezone,
                "is_bookable": barber.is_bookable,
            }
        )

    @app.patch(f"{settings.api_prefix}/admin/barbers/<barber_id>")
    @require_role(UserRole.ADMIN)
    def update_barber(barber_id: str):
        payload = request.get_json(force=True, silent=True) or {}
        barber = g.db.get(Barber, barber_id)
        if not barber:
            return jsonify({"detail": "Barbero no encontrado"}), 404
        if "display_name" in payload:
            barber.display_name = payload["display_name"]
        if "timezone" in payload:
            barber.timezone = payload["timezone"]
        if "is_bookable" in payload:
            barber.is_bookable = bool(payload["is_bookable"])
        g.db.add(barber)
        g.db.commit()
        g.db.refresh(barber)
        return jsonify(
            {
                "id": barber.id,
                "display_name": barber.display_name,
                "has_photo": bool(barber.photo_blob),
                "timezone": barber.timezone,
                "is_bookable": barber.is_bookable,
            }
        )

    @app.put(f"{settings.api_prefix}/admin/barbers/<barber_id>/photo")
    @require_role(UserRole.ADMIN)
    def upload_barber_photo(barber_id: str):
        barber = g.db.get(Barber, barber_id)
        if not barber:
            return jsonify({"detail": "Barbero no encontrado"}), 404
        f = request.files.get("photo")
        if not f:
            return jsonify({"detail": "photo es requerido"}), 400
        blob = f.read()
        if not blob:
            return jsonify({"detail": "photo vacío"}), 400
        barber.photo_blob = blob
        barber.photo_mime = f.mimetype or "application/octet-stream"
        g.db.add(barber)
        g.db.commit()
        return jsonify({"ok": True, "has_photo": True})

    @app.delete(f"{settings.api_prefix}/admin/barbers/<barber_id>/photo")
    @require_role(UserRole.ADMIN)
    def delete_barber_photo(barber_id: str):
        barber = g.db.get(Barber, barber_id)
        if not barber:
            return jsonify({"detail": "Barbero no encontrado"}), 404
        barber.photo_blob = None
        barber.photo_mime = None
        g.db.add(barber)
        g.db.commit()
        return jsonify({"ok": True, "has_photo": False})

    @app.get(f"{settings.api_prefix}/admin/barbers/<barber_id>/services")
    @require_role(UserRole.ADMIN)
    def get_barber_services(barber_id: str):
        items = g.db.execute(select(BarberService.service_id).where(BarberService.barber_id == barber_id)).scalars().all()
        return jsonify(list(items))

    @app.delete(f"{settings.api_prefix}/admin/barbers/<barber_id>")
    @require_role(UserRole.ADMIN)
    def delete_barber(barber_id: str):
        barber = g.db.get(Barber, barber_id)
        if not barber:
            return jsonify({"detail": "Barbero no encontrado"}), 404
        barber.is_bookable = False
        g.db.add(barber)
        g.db.commit()
        return jsonify({"ok": True})

    @app.get(f"{settings.api_prefix}/admin/services")
    @require_role(UserRole.ADMIN)
    def list_services():
        services = g.db.execute(select(Service).order_by(Service.name)).scalars().all()
        return jsonify(
            [
                {
                    "id": s.id,
                    "name": s.name,
                    "duration_min": s.duration_min,
                    "price_cents": s.price_cents,
                    "requires_payment": s.requires_payment,
                    "is_active": s.is_active,
                }
                for s in services
            ]
        )

    @app.post(f"{settings.api_prefix}/admin/services")
    @require_role(UserRole.ADMIN)
    def create_service():
        payload = request.get_json(force=True, silent=True) or {}
        name = payload.get("name")
        duration_min = payload.get("duration_min")
        price_cents = payload.get("price_cents")
        requires_payment = bool(payload.get("requires_payment", False))
        if not name or not isinstance(duration_min, int) or not isinstance(price_cents, int):
            return jsonify({"detail": "name, duration_min(int), price_cents(int) son requeridos"}), 400

        service = Service(name=name, duration_min=duration_min, price_cents=price_cents, requires_payment=requires_payment, is_active=True)
        g.db.add(service)
        g.db.commit()
        g.db.refresh(service)
        return jsonify(
            {
                "id": service.id,
                "name": service.name,
                "duration_min": service.duration_min,
                "price_cents": service.price_cents,
                "requires_payment": service.requires_payment,
                "is_active": service.is_active,
            }
        )

    @app.patch(f"{settings.api_prefix}/admin/services/<service_id>")
    @require_role(UserRole.ADMIN)
    def update_service(service_id: str):
        payload = request.get_json(force=True, silent=True) or {}
        service = g.db.get(Service, service_id)
        if not service:
            return jsonify({"detail": "Servicio no encontrado"}), 404
        for key in ["name", "duration_min", "price_cents", "requires_payment", "is_active"]:
            if key in payload:
                setattr(service, key, payload[key])
        g.db.add(service)
        g.db.commit()
        g.db.refresh(service)
        return jsonify(
            {
                "id": service.id,
                "name": service.name,
                "duration_min": service.duration_min,
                "price_cents": service.price_cents,
                "requires_payment": service.requires_payment,
                "is_active": service.is_active,
            }
        )

    @app.delete(f"{settings.api_prefix}/admin/services/<service_id>")
    @require_role(UserRole.ADMIN)
    def delete_service(service_id: str):
        service = g.db.get(Service, service_id)
        if not service:
            return jsonify({"detail": "Servicio no encontrado"}), 404
        service.is_active = False
        g.db.add(service)
        g.db.commit()
        return jsonify({"ok": True})

    @app.post(f"{settings.api_prefix}/admin/barbers/<barber_id>/services/<service_id>")
    @require_role(UserRole.ADMIN)
    def add_service_to_barber(barber_id: str, service_id: str):
        barber = g.db.get(Barber, barber_id)
        service = g.db.get(Service, service_id)
        if not barber or not service:
            return jsonify({"detail": "Barbero/Servicio no encontrado"}), 404
        existing = g.db.get(BarberService, {"barber_id": barber_id, "service_id": service_id})
        if existing:
            return jsonify({"ok": True})
        g.db.add(BarberService(barber_id=barber_id, service_id=service_id))
        g.db.commit()
        return jsonify({"ok": True})

    @app.delete(f"{settings.api_prefix}/admin/barbers/<barber_id>/services/<service_id>")
    @require_role(UserRole.ADMIN)
    def remove_service_from_barber(barber_id: str, service_id: str):
        existing = g.db.get(BarberService, {"barber_id": barber_id, "service_id": service_id})
        if not existing:
            return jsonify({"ok": True})
        g.db.delete(existing)
        g.db.commit()
        return jsonify({"ok": True})

    @app.get(f"{settings.api_prefix}/admin/barbers/<barber_id>/weekly")
    @require_role(UserRole.ADMIN)
    def get_weekly(barber_id: str):
        items = g.db.execute(select(ScheduleWeekly).where(ScheduleWeekly.barber_id == barber_id)).scalars().all()
        return jsonify(
            [
                {"id": i.id, "weekday": i.weekday, "start_time": i.start_time.isoformat(), "end_time": i.end_time.isoformat(), "is_active": i.is_active}
                for i in items
            ]
        )

    @app.post(f"{settings.api_prefix}/admin/barbers/<barber_id>/weekly")
    @require_role(UserRole.ADMIN)
    def add_weekly(barber_id: str):
        def overlaps(a_start, a_end, b_start, b_end) -> bool:
            return a_start < b_end and a_end > b_start

        payload = request.get_json(force=True, silent=True) or {}
        weekday = payload.get("weekday")
        start_time = payload.get("start_time")
        end_time = payload.get("end_time")
        is_active = bool(payload.get("is_active", True))
        if not isinstance(weekday, int) or not start_time or not end_time:
            return jsonify({"detail": "weekday(int), start_time, end_time son requeridos"}), 400
        if weekday < 0 or weekday > 6:
            return jsonify({"detail": "weekday debe estar entre 0 (Dom) y 6 (Sáb)"}), 400
        try:
            st = time.fromisoformat(start_time)
            et = time.fromisoformat(end_time)
        except ValueError:
            return jsonify({"detail": "Formato de hora inválido (HH:MM)"}), 400
        if et <= st:
            return jsonify({"detail": "Rango inválido"}), 400

        existing = g.db.execute(
            select(ScheduleWeekly).where(and_(ScheduleWeekly.barber_id == barber_id, ScheduleWeekly.weekday == weekday))
        ).scalars().all()
        for seg in existing:
            if overlaps(st, et, seg.start_time, seg.end_time):
                return jsonify({"detail": "El horario se solapa con otro segmento existente"}), 400

        item = ScheduleWeekly(barber_id=barber_id, weekday=weekday, start_time=st, end_time=et, is_active=is_active)
        g.db.add(item)
        g.db.commit()
        g.db.refresh(item)
        return jsonify({"id": item.id, "weekday": item.weekday, "start_time": item.start_time.isoformat(), "end_time": item.end_time.isoformat(), "is_active": item.is_active})

    @app.patch(f"{settings.api_prefix}/admin/barbers/<barber_id>/weekly/<weekly_id>")
    @require_role(UserRole.ADMIN)
    def update_weekly(barber_id: str, weekly_id: str):
        def overlaps(a_start, a_end, b_start, b_end) -> bool:
            return a_start < b_end and a_end > b_start

        payload = request.get_json(force=True, silent=True) or {}
        item = g.db.get(ScheduleWeekly, weekly_id)
        if not item or item.barber_id != barber_id:
            return jsonify({"detail": "Horario no encontrado"}), 404
        if "weekday" in payload and isinstance(payload["weekday"], int):
            item.weekday = payload["weekday"]
        if "start_time" in payload and payload["start_time"]:
            try:
                item.start_time = time.fromisoformat(payload["start_time"])
            except ValueError:
                return jsonify({"detail": "Formato de hora inválido (HH:MM)"}), 400
        if "end_time" in payload and payload["end_time"]:
            try:
                item.end_time = time.fromisoformat(payload["end_time"])
            except ValueError:
                return jsonify({"detail": "Formato de hora inválido (HH:MM)"}), 400
        if "is_active" in payload:
            item.is_active = bool(payload["is_active"])
        if item.weekday < 0 or item.weekday > 6:
            return jsonify({"detail": "weekday debe estar entre 0 (Dom) y 6 (Sáb)"}), 400
        if item.end_time <= item.start_time:
            return jsonify({"detail": "Rango inválido"}), 400

        existing = g.db.execute(
            select(ScheduleWeekly).where(
                and_(
                    ScheduleWeekly.barber_id == barber_id,
                    ScheduleWeekly.weekday == item.weekday,
                    ScheduleWeekly.id != item.id,
                )
            )
        ).scalars().all()
        for seg in existing:
            if overlaps(item.start_time, item.end_time, seg.start_time, seg.end_time):
                return jsonify({"detail": "El horario se solapa con otro segmento existente"}), 400

        g.db.add(item)
        g.db.commit()
        g.db.refresh(item)
        return jsonify({"id": item.id, "weekday": item.weekday, "start_time": item.start_time.isoformat(), "end_time": item.end_time.isoformat(), "is_active": item.is_active})

    @app.delete(f"{settings.api_prefix}/admin/barbers/<barber_id>/weekly/<weekly_id>")
    @require_role(UserRole.ADMIN)
    def delete_weekly(barber_id: str, weekly_id: str):
        item = g.db.get(ScheduleWeekly, weekly_id)
        if not item or item.barber_id != barber_id:
            return jsonify({"detail": "Horario no encontrado"}), 404
        g.db.delete(item)
        g.db.commit()
        return jsonify({"ok": True})

    @app.get(f"{settings.api_prefix}/admin/barbers/<barber_id>/exceptions")
    @require_role(UserRole.ADMIN)
    def get_exceptions(barber_id: str):
        items = g.db.execute(select(ScheduleException).where(ScheduleException.barber_id == barber_id)).scalars().all()
        return jsonify(
            [
                {
                    "id": i.id,
                    "date": i.date.isoformat(),
                    "start_time": i.start_time.isoformat() if i.start_time else None,
                    "end_time": i.end_time.isoformat() if i.end_time else None,
                    "type": i.type.value,
                    "reason": i.reason,
                }
                for i in items
            ]
        )

    @app.post(f"{settings.api_prefix}/admin/barbers/<barber_id>/exceptions")
    @require_role(UserRole.ADMIN)
    def add_exception(barber_id: str):
        payload = request.get_json(force=True, silent=True) or {}
        d = payload.get("date")
        ex_type = payload.get("type")
        start_time = payload.get("start_time")
        end_time = payload.get("end_time")
        reason = payload.get("reason")
        if not d or ex_type not in ("BLOCK", "OPEN"):
            return jsonify({"detail": "date y type(BLOCK|OPEN) son requeridos"}), 400
        try:
            d_obj = datetime.strptime(d, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"detail": "Formato de date inválido (YYYY-MM-DD)"}), 400

        st = et = None
        if (start_time and not end_time) or (end_time and not start_time):
            return jsonify({"detail": "start_time y end_time deben venir juntos o ser null"}), 400
        if start_time and end_time:
            try:
                st = datetime.strptime(start_time, "%H:%M").time()
                et = datetime.strptime(end_time, "%H:%M").time()
            except ValueError:
                return jsonify({"detail": "Formato de hora inválido (HH:MM)"}), 400
            if et <= st:
                return jsonify({"detail": "Rango inválido"}), 400

        item = ScheduleException(barber_id=barber_id, date=d_obj, start_time=st, end_time=et, type=ExceptionType(ex_type), reason=reason)
        g.db.add(item)
        g.db.commit()
        g.db.refresh(item)
        return jsonify(
            {
                "id": item.id,
                "date": item.date.isoformat(),
                "start_time": item.start_time.isoformat() if item.start_time else None,
                "end_time": item.end_time.isoformat() if item.end_time else None,
                "type": item.type.value,
                "reason": item.reason,
            }
        )

    @app.delete(f"{settings.api_prefix}/admin/barbers/<barber_id>/exceptions/<exception_id>")
    @require_role(UserRole.ADMIN)
    def delete_exception(barber_id: str, exception_id: str):
        item = g.db.get(ScheduleException, exception_id)
        if not item or item.barber_id != barber_id:
            return jsonify({"detail": "Excepción no encontrada"}), 404
        g.db.delete(item)
        g.db.commit()
        return jsonify({"ok": True})

    @app.get(f"{settings.api_prefix}/admin/clients")
    @require_role(UserRole.ADMIN)
    def list_clients():
        users = g.db.execute(select(User).where(User.role == UserRole.CLIENT).order_by(User.created_at.desc())).scalars().all()
        return jsonify(
            [
                {
                    "id": u.id,
                    "email": u.email,
                    "full_name": u.full_name,
                    "phone": u.phone,
                    "is_active": u.is_active,
                    "created_at": u.created_at.isoformat(),
                }
                for u in users
            ]
        )

    @app.post(f"{settings.api_prefix}/admin/clients")
    @require_role(UserRole.ADMIN)
    def create_client():
        payload = request.get_json(force=True, silent=True) or {}
        email = payload.get("email")
        full_name = payload.get("full_name")
        phone = payload.get("phone")
        if not email or not full_name:
            return jsonify({"detail": "email y full_name son requeridos"}), 400
        existing = g.db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing:
            return jsonify({"detail": "Email ya existe"}), 400
        user = User(email=email, password_hash=None, role=UserRole.CLIENT, full_name=full_name, phone=phone, is_active=True)
        g.db.add(user)
        g.db.commit()
        g.db.refresh(user)
        return jsonify(
            {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "phone": user.phone,
                "is_active": user.is_active,
                "created_at": user.created_at.isoformat(),
            }
        )

    @app.patch(f"{settings.api_prefix}/admin/clients/<user_id>")
    @require_role(UserRole.ADMIN)
    def update_client(user_id: str):
        payload = request.get_json(force=True, silent=True) or {}
        user = g.db.get(User, user_id)
        if not user or user.role != UserRole.CLIENT:
            return jsonify({"detail": "Cliente no encontrado"}), 404
        if "full_name" in payload:
            user.full_name = payload["full_name"]
        if "phone" in payload:
            user.phone = payload["phone"]
        if "is_active" in payload:
            user.is_active = bool(payload["is_active"])
        g.db.add(user)
        g.db.commit()
        g.db.refresh(user)
        return jsonify(
            {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "phone": user.phone,
                "is_active": user.is_active,
                "created_at": user.created_at.isoformat(),
            }
        )

    @app.delete(f"{settings.api_prefix}/admin/clients/<user_id>")
    @require_role(UserRole.ADMIN)
    def delete_client(user_id: str):
        user = g.db.get(User, user_id)
        if not user or user.role != UserRole.CLIENT:
            return jsonify({"detail": "Cliente no encontrado"}), 404
        user.is_active = False
        g.db.add(user)
        g.db.commit()
        return jsonify({"ok": True})

    @app.get(f"{settings.api_prefix}/catalog/barbers")
    def catalog_barbers():
        barbers = g.db.execute(select(Barber).where(Barber.is_bookable == True).order_by(Barber.display_name)).scalars().all()
        return jsonify(
            [
                {
                    "id": b.id,
                    "display_name": b.display_name,
                    "has_photo": bool(b.photo_blob),
                    "timezone": b.timezone,
                    "is_bookable": b.is_bookable,
                }
                for b in barbers
            ]
        )

    @app.get(f"{settings.api_prefix}/catalog/barbers/<barber_id>/photo")
    def get_barber_photo(barber_id: str):
        barber = g.db.get(Barber, barber_id)
        if not barber or not barber.photo_blob:
            return jsonify({"detail": "Foto no encontrada"}), 404
        return send_file(
            BytesIO(barber.photo_blob),
            mimetype=barber.photo_mime or "application/octet-stream",
            download_name=f"barber-{barber_id}",
            max_age=3600,
        )

    @app.get(f"{settings.api_prefix}/catalog/payment-methods")
    def catalog_payment_methods():
        items = g.db.execute(select(PaymentMethod).order_by(PaymentMethod.id)).scalars().all()
        if not items:
            g.db.add_all(
                [
                    PaymentMethod(name="Efectivo", iva_percent=19.00),
                    PaymentMethod(name="Transferencia", iva_percent=19.00),
                    PaymentMethod(name="RedCompra", iva_percent=19.00),
                ]
            )
            g.db.commit()
            items = g.db.execute(select(PaymentMethod).order_by(PaymentMethod.id)).scalars().all()
        return jsonify(
            [{"id": pm.id, "name": pm.name, "iva_percent": float(pm.iva_percent)} for pm in items]
        )

    @app.get(f"{settings.api_prefix}/catalog/services")
    def catalog_services():
        barber_id = request.args.get("barber_id")
        if not barber_id:
            return jsonify({"detail": "barber_id es requerido"}), 400
        services = g.db.execute(
            select(Service)
            .join(BarberService, BarberService.service_id == Service.id)
            .where(and_(BarberService.barber_id == barber_id, Service.is_active == True))
            .order_by(Service.name)
        ).scalars().all()
        return jsonify(
            [
                {
                    "id": s.id,
                    "name": s.name,
                    "duration_min": s.duration_min,
                    "price_cents": s.price_cents,
                    "requires_payment": s.requires_payment,
                    "is_active": s.is_active,
                }
                for s in services
            ]
        )

    @app.get(f"{settings.api_prefix}/availability")
    def availability():
        barber_id = request.args.get("barber_id")
        service_id = request.args.get("service_id")
        day = request.args.get("day")
        if not barber_id or not service_id or not day:
            return jsonify({"detail": "barber_id, service_id, day son requeridos"}), 400
        try:
            d = datetime.strptime(day, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"detail": "Formato day inválido (YYYY-MM-DD)"}), 400
        try:
            slot_minutes, starts = get_available_start_times(g.db, barber_id=barber_id, service_id=service_id, day=d)
        except ValueError as exc:
            return jsonify({"detail": str(exc)}), 400
        return jsonify({"date": d.isoformat(), "slot_minutes": slot_minutes, "available_start_times": [dt.isoformat() for dt in starts]})

    @app.post(f"{settings.api_prefix}/booking/verify/request")
    def booking_verify_request():
        payload = request.get_json(force=True, silent=True) or {}
        email = (payload.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return jsonify({"detail": "Email inválido"}), 400
        if not settings.smtp_enabled:
            if settings.booking_dev_code:
                return jsonify({"ok": True, "cooldown_seconds": 0}), 200
            return jsonify({"detail": "SMTP no configurado"}), 503

        now = datetime.utcnow()
        recent = (
            g.db.execute(
                select(EmailVerification)
                .where(and_(EmailVerification.email == email, EmailVerification.created_at >= now - timedelta(seconds=60)))
                .order_by(EmailVerification.created_at.desc())
            )
            .scalars()
            .first()
        )
        if recent:
            return jsonify({"ok": True, "cooldown_seconds": 60}), 200

        code = f"{secrets.randbelow(1_000_000):06d}"
        code_hash = hash_password(code)
        item = EmailVerification(email=email, code_hash=code_hash, expires_at=now + timedelta(minutes=10), used_at=None, attempt_count=0)
        g.db.add(item)
        g.db.commit()
        g.db.refresh(item)

        send_simple_email_async(
            SimpleEmail(
                to_email=email,
                subject="Código de verificación — BarberShop",
                text_body="\n".join(
                    [
                        "Tu código de verificación es:",
                        "",
                        code,
                        "",
                        "Expira en 10 minutos.",
                    ]
                ),
            )
        )
        return jsonify({"ok": True, "cooldown_seconds": 60}), 200

    @app.post(f"{settings.api_prefix}/booking/verify/confirm")
    def booking_verify_confirm():
        payload = request.get_json(force=True, silent=True) or {}
        email = (payload.get("email") or "").strip().lower()
        code = (payload.get("code") or "").strip()
        if not email or "@" not in email:
            return jsonify({"detail": "email es requerido"}), 400

        if not settings.smtp_enabled and settings.booking_dev_code:
            accepted = {settings.booking_dev_code, "111111"}
            if code and code not in accepted:
                return jsonify({"detail": "Código inválido"}), 400
            token = create_booking_token(email=email)
            return jsonify({"ok": True, "booking_token": token, "email": email}), 200
        if not code:
            return jsonify({"detail": "code es requerido"}), 400

        now = datetime.utcnow()
        item = (
            g.db.execute(
                select(EmailVerification)
                .where(and_(EmailVerification.email == email, EmailVerification.used_at.is_(None), EmailVerification.expires_at > now))
                .order_by(EmailVerification.created_at.desc())
            )
            .scalars()
            .first()
        )
        if not item:
            return jsonify({"detail": "Código inválido o expirado"}), 400
        if item.attempt_count >= 5:
            return jsonify({"detail": "Demasiados intentos. Solicita un nuevo código"}), 429
        ok = check_password_hash(item.code_hash, code)
        if not ok:
            item.attempt_count = int(item.attempt_count or 0) + 1
            g.db.add(item)
            g.db.commit()
            return jsonify({"detail": "Código inválido"}), 400

        item.used_at = now
        g.db.add(item)
        g.db.commit()

        token = create_booking_token(email=email)
        return jsonify({"ok": True, "booking_token": token, "email": email}), 200

    @app.post(f"{settings.api_prefix}/booking/session/guest")
    def booking_session_guest():
        payload = request.get_json(force=True, silent=True) or {}
        email = (payload.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return jsonify({"detail": "Email inválido"}), 400
        token = create_booking_token(email=email)
        return jsonify({"ok": True, "booking_token": token, "email": email}), 200

    @app.post(f"{settings.api_prefix}/booking/session/firebase")
    def booking_session_firebase():
        payload = request.get_json(force=True, silent=True) or {}
        id_token = (payload.get("id_token") or "").strip()
        decoded = verify_firebase_id_token(id_token)
        if not decoded:
            return jsonify({"detail": "Firebase no configurado o token inválido"}), 401
        email = (decoded.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return jsonify({"detail": "Email inválido"}), 400
        token = create_booking_token(email=email)
        return jsonify({"ok": True, "booking_token": token, "email": email}), 200

    @app.post(f"{settings.api_prefix}/appointments/book")
    def book():
        payload = request.get_json(force=True, silent=True) or {}
        verified_email = verify_booking_token(request.headers.get("X-Booking-Token", ""))
        barber_id = payload.get("barber_id")
        service_id = payload.get("service_id")
        start_at = payload.get("start_at")
        payment_method_id = payload.get("payment_method_id")
        client_email = (payload.get("client_email") or "").strip().lower()
        client_full_name = (payload.get("client_full_name") or "").strip()
        client_phone = (payload.get("client_phone") or "").strip()
        if not verified_email:
            if not settings.smtp_enabled and settings.booking_dev_code:
                if not client_email:
                    return jsonify({"detail": "client_email es requerido"}), 400
                verified_email = client_email
            else:
                return jsonify({"detail": "Verificación requerida"}), 401
        if client_email and client_email != verified_email:
            return jsonify({"detail": "Email no coincide con verificación"}), 400
        final_email = (client_email or verified_email).strip().lower()
        if not barber_id or not service_id or not start_at or not final_email or not client_full_name or not client_phone:
            return jsonify({"detail": "barber_id, service_id, start_at, client_email, client_full_name, client_phone son requeridos"}), 400
        if payment_method_id is None:
            payment_method_id = 1
        if not isinstance(payment_method_id, int):
            return jsonify({"detail": "payment_method_id debe ser int"}), 400
        pm = g.db.get(PaymentMethod, payment_method_id)
        if not pm:
            return jsonify({"detail": "Forma de pago no encontrada"}), 400
        try:
            start_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return jsonify({"detail": "Formato start_at inválido (ISO8601)"}), 400

        user = g.db.execute(select(User).where(func.lower(User.email) == final_email)).scalar_one_or_none()
        if not user:
            user = User(email=final_email, password_hash=None, role=UserRole.CLIENT, full_name=client_full_name, phone=client_phone, is_active=True)
            g.db.add(user)
            g.db.commit()
            g.db.refresh(user)
        else:
            user.role = UserRole.CLIENT
            user.is_active = True
            user.full_name = client_full_name
            user.phone = client_phone
            g.db.add(user)
            g.db.commit()
            g.db.refresh(user)

        try:
            appointment = book_appointment_by_slots(g.db, barber_id=barber_id, service_id=service_id, start_at=start_dt, client_user=user)
        except ValueError as exc:
            return jsonify({"detail": str(exc)}), 409

        if pm.name == "RedCompra":
            appointment.payment_url = (f"{_FRONTEND_URL}/pay/{appointment.id}")
        else:
            appointment.payment_url = None
            appointment.status = AppointmentStatus.CONFIRMED
        appointment.payment_method_id = payment_method_id
        appointment.calendar_event_id = f"demo-{appointment.id}"
        g.db.add(appointment)
        g.db.commit()
        g.db.refresh(appointment)

        barber = g.db.get(Barber, barber_id)
        service = g.db.get(Service, service_id)
        status = appointment.status.value
        subject = f"Reserva {status} — {service.name if service else ''}".strip()
        when = f"{appointment.start_at.isoformat(sep=' ', timespec='minutes')} - {appointment.end_at.isoformat(sep=' ', timespec='minutes')}"
        description = "\n".join(
            [
                f"Estado: {status}",
                f"Barbero: {barber.display_name if barber else barber_id}",
                f"Servicio: {service.name if service else service_id}",
                f"Horario: {when}",
                f"Cliente: {client_full_name}",
                f"Teléfono: {client_phone}",
                f"Email: {final_email}",
                f"Forma de pago: {pm.name} (IVA {float(pm.iva_percent):.2f}%)",
                f"Pago: {appointment.payment_url or 'No requerido'}",
            ]
        )
        ics = build_appointment_ics(
            uid=appointment.id,
            summary=f"{service.name if service else 'Servicio'} - {barber.display_name if barber else 'Barbero'}",
            description=description,
            start_at=appointment.start_at,
            end_at=appointment.end_at,
            status="CONFIRMED" if status == AppointmentStatus.CONFIRMED.value else "TENTATIVE",
        )
        send_booking_email_async(
            BookingEmail(
                to_email=final_email,
                subject=subject,
                text_body="Gracias por tu reserva.\n\n" + description,
                ics_bytes=ics,
                ics_filename=f"reserva-{appointment.id}.ics",
            )
        )

        return jsonify(
            {
                "id": appointment.id,
                "barber_id": appointment.barber_id,
                "service_id": appointment.service_id,
                "client_user_id": appointment.client_user_id,
                "client_email": final_email,
                "client_full_name": user.full_name,
                "client_phone": user.phone,
                "start_at": appointment.start_at.isoformat(),
                "end_at": appointment.end_at.isoformat(),
                "status": appointment.status.value,
                "price_cents": appointment.price_cents,
                "payment_url": appointment.payment_url,
            }
        )

    @app.get(f"{settings.api_prefix}/booking/appointments")
    def booking_appointments():
        verified_email = verify_booking_token(request.headers.get("X-Booking-Token", ""), max_age_seconds=7 * 24 * 60 * 60)
        if not verified_email:
            return jsonify({"detail": "Verificación requerida"}), 401

        rows = (
            g.db.execute(
                select(Appointment, Barber.display_name, Service.name, Service.duration_min)
                .join(User, User.id == Appointment.client_user_id)
                .join(Barber, Barber.id == Appointment.barber_id)
                .join(Service, Service.id == Appointment.service_id)
                .where(User.email == verified_email)
                .order_by(Appointment.start_at.desc())
            )
            .all()
        )
        return jsonify(
            [
                {
                    "id": appt.id,
                    "start_at": appt.start_at.isoformat(),
                    "end_at": appt.end_at.isoformat(),
                    "status": appt.status.value,
                    "barber_name": barber_name,
                    "service_name": service_name,
                    "duration_min": duration_min,
                    "price_cents": appt.price_cents,
                    "payment_url": appt.payment_url,
                }
                for appt, barber_name, service_name, duration_min in rows
            ]
        )

    @app.get(f"{settings.api_prefix}/booking/client")
    def booking_client():
        verified_email = verify_booking_token(request.headers.get("X-Booking-Token", ""), max_age_seconds=7 * 24 * 60 * 60)
        email = verified_email
        if not email and (not settings.smtp_enabled and settings.booking_dev_code):
            email = (request.args.get("email") or "").strip().lower() or None
        if not email:
            return jsonify({"detail": "Verificación requerida"}), 401

        user = g.db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()
        return jsonify(
            {
                "email": email,
                "full_name": user.full_name if user else None,
                "phone": user.phone if user else None,
            }
        )

    @app.get(f"{settings.api_prefix}/booking/client/exists")
    def booking_client_exists():
        email = (request.args.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return jsonify({"detail": "Email inválido"}), 400
        user = (
            g.db.execute(
                select(User).where(and_(func.lower(User.email) == email, User.role == UserRole.CLIENT, User.is_active == True))
            )
            .scalars()
            .first()
        )
        return jsonify({"email": email, "exists": bool(user)})

    @app.get(f"{settings.api_prefix}/debug/dbinfo")
    def debug_dbinfo():
        url = settings.database_url
        if url.startswith("sqlite"):
            return jsonify({"dialect": "sqlite", "db_auto_create": settings.db_auto_create, "api_prefix": settings.api_prefix})
        if url.startswith("mssql+pyodbc"):
            return jsonify(
                {
                    "dialect": "mssql+pyodbc",
                    "azure_server": (os.getenv("AZURE_SQL_SERVER") or "").strip() or None,
                    "azure_database": (os.getenv("AZURE_SQL_DATABASE") or "").strip() or None,
                    "db_auto_create": settings.db_auto_create,
                    "api_prefix": settings.api_prefix,
                }
            )
        return jsonify({"dialect": "unknown", "db_auto_create": settings.db_auto_create, "api_prefix": settings.api_prefix})

    return app


app = create_app()
