from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import wraps

from flask import g, jsonify, request
from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from app.config import settings
from app.models import UserRole


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return check_password_hash(password_hash, password)
    except ValueError:
        return False


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.jwt_secret, salt="barbershop-token")

def _booking_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.jwt_secret, salt="barbershop-booking")


def create_access_token(*, user_id: str, role: str) -> str:
    payload = {"sub": user_id, "role": role, "iat": datetime.utcnow().isoformat()}
    return _serializer().dumps(payload)

def create_booking_token(*, email: str) -> str:
    payload = {"email": email, "iat": datetime.utcnow().isoformat()}
    return _booking_serializer().dumps(payload)


def verify_booking_token(token: str, *, max_age_seconds: int = 15 * 60) -> str | None:
    if not token:
        return None
    try:
        payload = _booking_serializer().loads(token, max_age=max_age_seconds)
    except (BadSignature, BadTimeSignature):
        return None
    email = payload.get("email")
    if not email:
        return None
    return str(email)


@dataclass(frozen=True)
class AuthInfo:
    user_id: str
    role: UserRole


def _get_auth() -> AuthInfo | None:
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = _serializer().loads(token, max_age=settings.jwt_access_minutes * 60)
    except (BadSignature, BadTimeSignature):
        return None
    user_id = payload.get("sub")
    role = payload.get("role")
    if not user_id or not role:
        return None
    try:
        role_enum = UserRole(role)
    except ValueError:
        return None
    return AuthInfo(user_id=str(user_id), role=role_enum)


def require_role(required: UserRole):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            info = _get_auth()
            if not info:
                return jsonify({"detail": "No autenticado"}), 401
            g.auth = info
            if info.role != required:
                return jsonify({"detail": "No autorizado"}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator
