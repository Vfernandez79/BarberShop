from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
import uuid

from sqlalchemy import Boolean, Column, Date, DateTime, Enum as SAEnum, ForeignKey, Integer, LargeBinary, Numeric, String, Time, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.utcnow()


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    BARBER = "BARBER"
    CLIENT = "CLIENT"


class ExceptionType(str, Enum):
    BLOCK = "BLOCK"
    OPEN = "OPEN"


class AppointmentStatus(str, Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(String(320), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=True)
    role = Column(SAEnum(UserRole), nullable=False)
    full_name = Column(String(200), nullable=True)
    phone = Column(String(40), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    barber = relationship("Barber", back_populates="user", uselist=False)


class Barber(Base):
    __tablename__ = "barbers"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    display_name = Column(String(200), nullable=False)
    photo_url = Column(String(500), nullable=True)
    photo_blob = Column(LargeBinary, nullable=True)
    photo_mime = Column(String(100), nullable=True)
    timezone = Column(String(64), nullable=False, default="UTC")
    is_bookable = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    user = relationship("User", back_populates="barber")
    services = relationship("BarberService", back_populates="barber", cascade="all, delete-orphan")


class Service(Base):
    __tablename__ = "services"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(150), nullable=False)
    duration_min = Column(Integer, nullable=False)
    price_cents = Column(Integer, nullable=False)
    requires_payment = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    barbers = relationship("BarberService", back_populates="service", cascade="all, delete-orphan")


class BarberService(Base):
    __tablename__ = "barber_services"

    barber_id = Column(String(36), ForeignKey("barbers.id"), primary_key=True)
    service_id = Column(String(36), ForeignKey("services.id"), primary_key=True)

    barber = relationship("Barber", back_populates="services")
    service = relationship("Service", back_populates="barbers")


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(String(320), nullable=False, index=True)
    code_hash = Column(String(255), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    used_at = Column(DateTime, nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=_utcnow)


class ScheduleWeekly(Base):
    __tablename__ = "schedule_weekly"

    id = Column(String(36), primary_key=True, default=_uuid)
    barber_id = Column(String(36), ForeignKey("barbers.id"), nullable=False, index=True)
    weekday = Column(Integer, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)


class ScheduleException(Base):
    __tablename__ = "schedule_exceptions"

    id = Column(String(36), primary_key=True, default=_uuid)
    barber_id = Column(String(36), ForeignKey("barbers.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    type = Column(SAEnum(ExceptionType), nullable=False)
    reason = Column(String(300), nullable=True)


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True)
    slot_minutes = Column(Integer, nullable=False, default=15)
    booking_horizon_days = Column(Integer, nullable=False, default=30)
    min_notice_minutes = Column(Integer, nullable=False, default=60)
    currency = Column(String(10), nullable=False, default="COP")
    updated_at = Column(DateTime, nullable=False, default=_utcnow)


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(80), nullable=False, unique=True)
    iva_percent = Column(Numeric(5, 2), nullable=False, default=19.00)



class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(String(36), primary_key=True, default=_uuid)
    client_user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    barber_id = Column(String(36), ForeignKey("barbers.id"), nullable=False, index=True)
    service_id = Column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    start_at = Column(DateTime, nullable=False, index=True)
    end_at = Column(DateTime, nullable=False)
    status = Column(SAEnum(AppointmentStatus), nullable=False)
    price_cents = Column(Integer, nullable=False)
    payment_url = Column(String(500), nullable=True)
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=False, default=1)
    calendar_event_id = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    slots = relationship("AppointmentSlot", back_populates="appointment", cascade="all, delete-orphan")


class AppointmentSlot(Base):
    __tablename__ = "appointment_slots"
    __table_args__ = (UniqueConstraint("barber_id", "slot_at", name="uq_slot_barber_time"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    appointment_id = Column(String(36), ForeignKey("appointments.id"), nullable=False, index=True)
    barber_id = Column(String(36), ForeignKey("barbers.id"), nullable=False, index=True)
    slot_at = Column(DateTime, nullable=False, index=True)

    appointment = relationship("Appointment", back_populates="slots")
