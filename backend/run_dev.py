import os

from app.main import app


def _truthy(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8001"))
    debug = _truthy(os.getenv("FLASK_DEBUG"))
    app.run(host=host, port=port, debug=debug, use_reloader=False)
