from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
import smtplib
import threading

from app.config import settings


@dataclass(frozen=True)
class BookingEmail:
    to_email: str
    subject: str
    text_body: str
    ics_bytes: bytes
    ics_filename: str


@dataclass(frozen=True)
class SimpleEmail:
    to_email: str
    subject: str
    text_body: str


def _escape_ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def build_appointment_ics(
    *,
    uid: str,
    summary: str,
    description: str,
    start_at: datetime,
    end_at: datetime,
    status: str,
) -> bytes:
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    dtstart = start_at.strftime("%Y%m%dT%H%M%S")
    dtend = end_at.strftime("%Y%m%dT%H%M%S")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BarberShop//Booking//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{_escape_ics_text(uid)}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"SUMMARY:{_escape_ics_text(summary)}",
        f"DESCRIPTION:{_escape_ics_text(description)}",
        f"STATUS:{status}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def _send_email_now(email: BookingEmail) -> None:
    if not settings.smtp_enabled:
        return
    if not settings.smtp_host:
        return

    from_addr = settings.smtp_from or settings.smtp_user or "no-reply@barbershop.local"

    msg = EmailMessage()
    msg["Subject"] = email.subject
    msg["From"] = from_addr
    msg["To"] = email.to_email
    msg.set_content(email.text_body)

    msg.add_attachment(
        email.ics_bytes,
        maintype="text",
        subtype="calendar",
        filename=email.ics_filename,
        params={"method": "REQUEST", "charset": "utf-8"},
    )

    if settings.smtp_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.ehlo()
        if settings.smtp_starttls:
            server.starttls()
            server.ehlo()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def _send_simple_email_now(email: SimpleEmail) -> None:
    if not settings.smtp_enabled:
        return
    if not settings.smtp_host:
        return

    from_addr = settings.smtp_from or settings.smtp_user or "no-reply@barbershop.local"

    msg = EmailMessage()
    msg["Subject"] = email.subject
    msg["From"] = from_addr
    msg["To"] = email.to_email
    msg.set_content(email.text_body)

    if settings.smtp_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.ehlo()
        if settings.smtp_starttls:
            server.starttls()
            server.ehlo()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send_booking_email_async(email: BookingEmail) -> None:
    def runner() -> None:
        try:
            _send_email_now(email)
        except Exception:
            return

    threading.Thread(target=runner, daemon=True).start()


def send_simple_email_async(email: SimpleEmail) -> None:
    def runner() -> None:
        try:
            _send_simple_email_now(email)
        except Exception:
            return

    threading.Thread(target=runner, daemon=True).start()
