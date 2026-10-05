from __future__ import annotations

import json
from pathlib import Path

from app.config import settings


def _load_service_account() -> dict | None:
    if settings.firebase_service_account_json:
        try:
            return json.loads(settings.firebase_service_account_json)
        except json.JSONDecodeError:
            return None
    if settings.firebase_service_account_path:
        p = Path(settings.firebase_service_account_path).expanduser()
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def verify_firebase_id_token(id_token: str) -> dict | None:
    if not id_token:
        return None

    sa = _load_service_account()
    if not sa:
        return None

    try:
        import firebase_admin  # type: ignore
        from firebase_admin import auth  # type: ignore
        from firebase_admin import credentials  # type: ignore
    except Exception:
        return None

    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(sa)
            firebase_admin.initialize_app(cred)
        decoded = auth.verify_id_token(id_token)
        return decoded
    except Exception:
        return None

